"""Arquivos na conta: links assinados, cota, confirmação e isolamento (SQLite em memória + S3 do moto)."""
from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlparse

import boto3
import httpx
import pytest
from moto import mock_aws
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool

from oghma.accounts.app import create_app, create_schema
from oghma.accounts.config import AccountSettings
from oghma.accounts import files
from oghma.accounts.files import object_key
from oghma.accounts.mailer import LogMailer
from oghma.accounts.models import AccountFile, AccountUser
from oghma.accounts.service import utcnow

from .test_accounts import SECRET, auth
from .test_social import person

BUCKET = "oghma-contas-teste"
MB = 1024 * 1024
SHA = "ab" * 32
OTHER = "cd" * 32


async def make_api(**overrides):
    settings = AccountSettings(
        database_url="sqlite+aiosqlite://",
        secret=SECRET,
        ip_requests_per_10min=1000,
        s3_region="us-east-1",
        s3_access_key_id="teste",
        s3_secret_access_key="teste",
        **overrides,
    )
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    await create_schema(engine)
    mailer = LogMailer()
    client = httpx.AsyncClient(transport=httpx.ASGITransport(app=create_app(settings, mailer, engine)), base_url="http://test")
    client.mailer = mailer  # type: ignore[attr-defined]
    client.engine = engine  # type: ignore[attr-defined]
    return client


@pytest.fixture
async def api():
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket=BUCKET)
        client = await make_api(files_bucket=BUCKET, file_quota_mb=3, max_file_mb=2)
        client.s3 = s3  # type: ignore[attr-defined]
        async with client:
            yield client
        await client.engine.dispose()


async def user_id(api, nickname: str) -> int:
    async with AsyncSession(api.engine) as db:
        return (await db.execute(select(AccountUser.id).where(AccountUser.email == f"{nickname}@example.com"))).scalar_one()


def ask(sha=SHA, kind="epub", ext="epub", size=1000) -> dict:
    return {"sha256": sha, "kind": kind, "ext": ext, "size": size}


def put(api, key: str, size: int) -> None:
    """Faz o papel do app: envia direto ao bucket."""
    api.s3.put_object(Bucket=BUCKET, Key=key, Body=b"x" * size)


def stored(api, key: str) -> bool:
    return api.s3.list_objects_v2(Bucket=BUCKET, Prefix=key).get("KeyCount", 0) > 0


async def upload(api, token: str, nickname: str, **fields) -> dict:
    """Pede o link, envia e confirma. Devolve o pedido usado."""
    body = ask(**fields)
    response = await api.post("/v1/me/files", headers=auth(token), json=body)
    assert response.status_code == 200 and response.json()["exists"] is False, response.text
    put(api, object_key(await user_id(api, nickname), body["sha256"], body["kind"], body["ext"]), body["size"])
    confirmed = await api.post(f"/v1/me/files/{body['sha256']}/confirm", headers=auth(token), json={"kind": body["kind"]})
    assert confirmed.status_code == 200 and confirmed.json() == {"ok": True}, confirmed.text
    return body


async def test_presign_points_at_the_private_key_and_then_the_file_exists(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    first = await api.post("/v1/me/files", headers=auth(token), json=ask())
    body = first.json()
    assert first.status_code == 200 and body["exists"] is False
    assert body["method"] == "PUT" and body["headers"] == {"Content-Type": "application/epub+zip"} and body["expiresIn"] == 900
    url = urlparse(body["uploadUrl"])
    assert BUCKET in url.netloc + url.path and url.path.endswith(f"accounts/{uid}/files/{SHA}.epub")
    assert "Signature" in url.query or "X-Amz-Signature" in url.query

    cover = (await api.post("/v1/me/files", headers=auth(token), json=ask(kind="cover", ext="png"))).json()
    assert cover["headers"] == {"Content-Type": "image/png"}
    assert urlparse(cover["uploadUrl"]).path.endswith(f"accounts/{uid}/files/{SHA}.cover.png")

    put(api, object_key(uid, SHA, "epub", "epub"), 1000)
    assert (await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"})).json() == {"ok": True}
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask())).json() == {"exists": True}

    got = await api.get(f"/v1/me/files/{SHA}", params={"kind": "epub"}, headers=auth(token))
    assert got.status_code == 200
    assert got.json()["size"] == 1000 and got.json()["ext"] == "epub"
    assert urlparse(got.json()["downloadUrl"]).path.endswith(f"accounts/{uid}/files/{SHA}.epub")


@pytest.mark.parametrize(
    "body",
    [
        ask(sha="AB" * 32),
        ask(sha="ab" * 31),
        ask(sha="g" * 64),
        ask(sha=None),
        ask(kind="pdf"),
        ask(ext="pdf"),
        ask(kind="cover", ext="epub"),
        ask(kind="epub", ext="jpg"),
        ask(size=0),
        ask(size=-1),
        ask(size="10"),
        ask(size=True),
        ask(size=1.5),
    ],
)
async def test_bad_requests_are_invalid_file(api, body):
    token, _ = await person(api, "ana")
    response = await api.post("/v1/me/files", headers=auth(token), json=body)
    assert response.status_code == 400 and response.json() == {"error": "invalid_file"}


async def test_files_over_the_limit_are_too_large(api):
    token, _ = await person(api, "ana")
    response = await api.post("/v1/me/files", headers=auth(token), json=ask(size=2 * MB + 1))
    assert response.status_code == 413 and response.json() == {"error": "file_too_large"}
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(size=2 * MB))).status_code == 200


async def test_quota_counts_confirmed_and_recent_pending_files(api):
    token, _ = await person(api, "ana")
    await upload(api, token, "ana", size=2 * MB)
    # Pendente recente também reserva a cota.
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(sha=OTHER, size=MB // 2))).status_code == 200
    third = "ef" * 32
    full = await api.post("/v1/me/files", headers=auth(token), json=ask(sha=third, size=MB))
    assert full.status_code == 409
    assert full.json() == {"error": "quota_exceeded", "usedBytes": 2 * MB + MB // 2, "quotaBytes": 3 * MB}

    # Asking again for the same pending file does not count it twice.
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(sha=OTHER, size=MB))).status_code == 200

    # A pending upload older than an hour stops holding quota.
    async with AsyncSession(api.engine) as db:
        await db.execute(update(AccountFile).where(AccountFile.sha256 == OTHER).values(created_at=utcnow() - timedelta(hours=2)))
        await db.commit()
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(sha=third, size=MB))).status_code == 200

    used = (await api.get("/v1/me/files/usage", headers=auth(token))).json()
    assert used == {"usedBytes": 3 * MB, "quotaBytes": 3 * MB, "files": 1}


async def test_confirm_without_upload_is_upload_missing(api):
    token, _ = await person(api, "ana")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask())).status_code == 200
    missing = await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"})
    assert missing.status_code == 409 and missing.json() == {"error": "upload_missing"}
    never_asked = await api.post(f"/v1/me/files/{OTHER}/confirm", headers=auth(token), json={"kind": "epub"})
    assert never_asked.status_code == 409 and never_asked.json() == {"error": "upload_missing"}
    bad = await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "pdf"})
    assert bad.status_code == 400 and bad.json() == {"error": "invalid_file"}


async def test_confirm_with_the_wrong_size_deletes_the_object(api):
    token, _ = await person(api, "ana")
    key = object_key(await user_id(api, "ana"), SHA, "epub", "epub")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(size=1000))).status_code == 200
    put(api, key, 999)
    wrong = await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"})
    assert wrong.status_code == 409 and wrong.json() == {"error": "size_mismatch"}
    assert not stored(api, key), "the wrong object is deleted"
    assert (await api.get(f"/v1/me/files/{SHA}", headers=auth(token))).status_code == 404


async def test_confirm_checks_the_quota_again(api):
    """The pending hold lasts one hour: a late confirm must still fit next to the confirmed files."""
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(size=2 * MB))).status_code == 200
    async with AsyncSession(api.engine) as db:
        await db.execute(update(AccountFile).where(AccountFile.sha256 == SHA).values(created_at=utcnow() - timedelta(hours=2)))
        await db.commit()
    await upload(api, token, "ana", sha=OTHER, size=2 * MB)
    key = object_key(uid, SHA, "epub", "epub")
    put(api, key, 2 * MB)
    late = await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"})
    assert late.status_code == 409
    assert late.json() == {"error": "quota_exceeded", "usedBytes": 2 * MB, "quotaBytes": 3 * MB}
    assert not stored(api, key), "the object over the quota is deleted"
    assert (await api.get(f"/v1/me/files/{SHA}", headers=auth(token))).status_code == 404
    assert (await api.get("/v1/me/files/usage", headers=auth(token))).json()["files"] == 1


async def test_a_concurrent_request_for_the_same_file_does_not_fail(api, monkeypatch):
    """Two requests race: both miss the row, the second insert hits the unique constraint."""
    token, _ = await person(api, "ana")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask())).status_code == 200
    real_find, calls = files.find, []

    async def racing_find(*args):
        calls.append(args)
        return None if len(calls) == 1 else await real_find(*args)

    monkeypatch.setattr(files, "find", racing_find)
    again = await api.post("/v1/me/files", headers=auth(token), json=ask())
    assert again.status_code == 200 and again.json()["exists"] is False, again.text
    assert len(calls) == 2
    monkeypatch.setattr(files, "find", real_find)
    async with AsyncSession(api.engine) as db:
        assert len((await db.execute(select(AccountFile).where(AccountFile.sha256 == SHA))).scalars().all()) == 1


async def test_asking_again_with_another_extension_drops_the_old_object(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask(kind="cover", ext="png"))).status_code == 200
    old = object_key(uid, SHA, "cover", "png")
    put(api, old, 1000)
    again = await api.post("/v1/me/files", headers=auth(token), json=ask(kind="cover", ext="jpg"))
    assert again.status_code == 200 and again.json()["headers"] == {"Content-Type": "image/jpeg"}
    assert not stored(api, old), "the pending object with the old extension is not left behind"
    put(api, object_key(uid, SHA, "cover", "jpg"), 1000)
    assert (await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "cover"})).json() == {"ok": True}
    assert (await api.get(f"/v1/me/files/{SHA}", params={"kind": "cover"}, headers=auth(token))).json()["ext"] == "jpg"


async def test_unconfirmed_files_are_not_found(api):
    token, _ = await person(api, "ana")
    assert (await api.post("/v1/me/files", headers=auth(token), json=ask())).status_code == 200
    put(api, object_key(await user_id(api, "ana"), SHA, "epub", "epub"), 1000)
    pending = await api.get(f"/v1/me/files/{SHA}", params={"kind": "epub"}, headers=auth(token))
    assert pending.status_code == 404 and pending.json() == {"error": "file_not_found"}
    assert (await api.get(f"/v1/me/files/{OTHER}", headers=auth(token))).status_code == 404
    # The cover is a separate file: the EPUB being confirmed does not make the cover exist.
    await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"})
    assert (await api.get(f"/v1/me/files/{SHA}", params={"kind": "cover"}, headers=auth(token))).status_code == 404
    assert (await api.get(f"/v1/me/files/{SHA}", params={"kind": "pdf"}, headers=auth(token))).status_code == 400
    for kind in ["pdf", "x" * 17]:
        bad = await api.get(f"/v1/me/files/{SHA}", params={"kind": kind}, headers=auth(token))
        assert bad.status_code == 400 and bad.json() == {"error": "invalid_file"}, kind


async def test_files_belong_to_one_account(api):
    ana, _ = await person(api, "ana")
    bia, _ = await person(api, "bia")
    await upload(api, ana, "ana")
    assert (await api.get(f"/v1/me/files/{SHA}", headers=auth(bia))).status_code == 404
    # Bia has the same book: she still uploads her own copy, under her own key.
    asked = (await api.post("/v1/me/files", headers=auth(bia), json=ask())).json()
    assert asked["exists"] is False
    assert f"accounts/{await user_id(api, 'bia')}/files/" in asked["uploadUrl"]
    # Ana's object does not confirm Bia's upload.
    missing = await api.post(f"/v1/me/files/{SHA}/confirm", headers=auth(bia), json={"kind": "epub"})
    assert missing.json() == {"error": "upload_missing"}
    assert (await api.get("/v1/me/files/usage", headers=auth(bia))).json()["files"] == 0
    assert (await api.get("/v1/me/files/usage", headers=auth(ana))).json() == {"usedBytes": 1000, "quotaBytes": 3 * MB, "files": 1}


async def test_routes_need_a_session(api):
    assert (await api.post("/v1/me/files", json=ask())).status_code == 401
    assert (await api.get("/v1/me/files/usage")).status_code == 401
    assert (await api.get(f"/v1/me/files/{SHA}")).status_code == 401
    assert (await api.post(f"/v1/me/files/{SHA}/confirm", json={"kind": "epub"})).status_code == 401


async def test_without_a_bucket_the_routes_are_disabled():
    client = await make_api(files_bucket="")
    async with client:
        token, _ = await person(client, "ana")
        calls = [
            client.post("/v1/me/files", headers=auth(token), json=ask()),
            client.post(f"/v1/me/files/{SHA}/confirm", headers=auth(token), json={"kind": "epub"}),
            client.get(f"/v1/me/files/{SHA}", headers=auth(token)),
            client.get("/v1/me/files/usage", headers=auth(token)),
        ]
        for call in calls:
            response = await call
            assert response.status_code == 503 and response.json() == {"error": "files_disabled"}
    await client.engine.dispose()
