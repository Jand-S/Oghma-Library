"""Limpeza dos arquivos na conta (`oghma-accounts-files-gc`): SQLite em memória + S3 do moto."""
from __future__ import annotations

import json
from datetime import timedelta

import boto3
from moto import mock_aws
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine

from oghma.accounts import files_gc
from oghma.accounts.app import create_schema
from oghma.accounts.config import AccountSettings, get_account_settings
from oghma.accounts.files import S3FileStore, object_key
from oghma.accounts.models import AccountFile
from oghma.accounts.service import utcnow

from .test_accounts import auth
from .test_accounts_files import BUCKET, SHA, OTHER, api, ask, put, stored, upload, user_id  # noqa: F401 (fixture)
from .test_social import person

DAY_MS = 86_400_000


def store_for(api) -> S3FileStore:
    settings = AccountSettings(files_bucket=BUCKET, s3_region="us-east-1", s3_access_key_id="teste", s3_secret_access_key="teste")
    return S3FileStore(settings, client=api.s3)


async def push(api, token: str, sha: str, **fields) -> None:
    change = {"key": f"import:{sha}", "changedAt": int(utcnow().timestamp() * 1000), "readingStatus": "unread", "onShelf": True, **fields}
    response = await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [change]})
    assert response.status_code == 200, response.text


async def age(api, sha: str, days: float, **columns) -> None:
    """Envelhece as linhas desse sha (`created_at` e, se confirmadas, `confirmed_at`)."""
    then = utcnow() - timedelta(days=days)
    async with AsyncSession(api.engine) as db:
        await db.execute(update(AccountFile).where(AccountFile.sha256 == sha).values(created_at=then, **columns))
        await db.execute(
            update(AccountFile).where(AccountFile.sha256 == sha, AccountFile.confirmed_at.is_not(None)).values(confirmed_at=then)
        )
        await db.commit()


async def rows(api) -> set[tuple[str, str]]:
    async with AsyncSession(api.engine) as db:
        return {(row.sha256, row.kind) for row in (await db.execute(select(AccountFile))).scalars()}


async def gc(api, **kwargs) -> files_gc.GcResult:
    async with AsyncSession(api.engine) as db:
        result = await files_gc.collect_garbage(db, store_for(api), **kwargs)
        await db.commit()
        return result


async def test_old_pending_uploads_are_removed_and_recent_ones_stay(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    for sha in (SHA, OTHER):
        assert (await api.post("/v1/me/files", headers=auth(token), json=ask(sha=sha))).status_code == 200
        put(api, object_key(uid, sha, "epub", "epub"), 1000)  # enviado, mas nunca confirmado
    await age(api, SHA, 1.5)
    await age(api, OTHER, 0.5)

    result = await gc(api)

    assert (result.pending, result.orphans, result.errors) == (1, 0, 0)
    assert await rows(api) == {(OTHER, "epub")}
    assert not stored(api, object_key(uid, SHA, "epub", "epub"))
    assert stored(api, object_key(uid, OTHER, "epub", "epub"))


async def test_files_of_a_live_entry_are_kept_however_old(api):
    token, _ = await person(api, "ana")
    await upload(api, token, "ana")
    await upload(api, token, "ana", kind="cover", ext="jpg")
    await push(api, token, SHA)
    await age(api, SHA, 400)

    assert await gc(api) == files_gc.GcResult()
    assert await rows(api) == {(SHA, "epub"), (SHA, "cover")}


async def test_tombstones_older_than_30_days_take_the_epub_and_the_cover(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    now_ms = int(utcnow().timestamp() * 1000)
    for sha, deleted_days in ((SHA, 31), (OTHER, 29)):
        await upload(api, token, "ana", sha=sha)
        await upload(api, token, "ana", sha=sha, kind="cover", ext="png")
        await push(api, token, sha, deletedAt=now_ms - deleted_days * DAY_MS)
        await age(api, sha, 60)

    result = await gc(api)

    assert (result.orphans, result.pending) == (2, 0)
    assert await rows(api) == {(OTHER, "epub"), (OTHER, "cover")}
    assert not stored(api, object_key(uid, SHA, "epub", "epub")) and not stored(api, object_key(uid, SHA, "cover", "png"))
    assert stored(api, object_key(uid, OTHER, "epub", "epub")) and stored(api, object_key(uid, OTHER, "cover", "png"))


async def test_files_without_any_entry_go_30_days_after_the_confirmation(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    await upload(api, token, "ana", sha=SHA)
    await upload(api, token, "ana", sha=OTHER)
    await age(api, SHA, 31)
    await age(api, OTHER, 29)

    result = await gc(api)

    assert result.orphans == 1
    assert await rows(api) == {(OTHER, "epub")}
    assert not stored(api, object_key(uid, SHA, "epub", "epub"))


async def test_an_entry_of_another_account_does_not_keep_the_file(api):
    ana, _ = await person(api, "ana")
    bia, _ = await person(api, "bia")
    await upload(api, ana, "ana")
    await push(api, bia, SHA)  # a mesma obra viva só na biblioteca da Bia
    await age(api, SHA, 31)

    assert (await gc(api)).orphans == 1
    assert await rows(api) == set()


async def test_objects_of_deleted_accounts_are_swept_and_other_keys_stay(api):
    ana, _ = await person(api, "ana")
    await person(api, "bia")
    ana_id, bia_id = await user_id(api, "ana"), await user_id(api, "bia")
    put(api, object_key(ana_id, SHA, "epub", "epub"), 10)
    put(api, object_key(bia_id, SHA, "epub", "epub"), 10)
    put(api, "accounts/readme.txt", 10)
    assert (await api.delete("/v1/me", headers=auth(ana))).status_code in {200, 204}

    result = await gc(api)

    assert result.gone_accounts == 1
    assert not stored(api, object_key(ana_id, SHA, "epub", "epub"))
    assert stored(api, object_key(bia_id, SHA, "epub", "epub")) and stored(api, "accounts/readme.txt")


async def test_dry_run_only_counts(api):
    token, _ = await person(api, "ana")
    uid = await user_id(api, "ana")
    await upload(api, token, "ana")
    await age(api, SHA, 31)

    assert (await gc(api, dry_run=True)).orphans == 1
    assert await rows(api) == {(SHA, "epub")} and stored(api, object_key(uid, SHA, "epub", "epub"))


async def test_a_bucket_error_keeps_the_row_for_the_next_run(api, monkeypatch):
    token, _ = await person(api, "ana")
    await upload(api, token, "ana")
    await age(api, SHA, 31)

    def broken(self, key):
        raise RuntimeError("bucket fora do ar")

    monkeypatch.setattr(S3FileStore, "delete", broken)
    result = await gc(api)

    assert (result.orphans, result.errors) == (0, 1)
    assert await rows(api) == {(SHA, "epub")}


def test_the_command_reads_the_environment_and_cleans(tmp_path, monkeypatch, capsys):
    url = f"sqlite+aiosqlite:///{tmp_path / 'contas.db'}"
    for name, value in {
        "DATABASE_URL": url,
        "FILES_BUCKET": BUCKET,
        "S3_REGION": "us-east-1",
        "S3_ACCESS_KEY_ID": "teste",
        "S3_SECRET_ACCESS_KEY": "teste",
    }.items():
        monkeypatch.setenv(f"OGHMA_ACCOUNTS_{name}", value)
    get_account_settings.cache_clear()

    async def seed() -> None:
        engine = create_async_engine(url)
        await create_schema(engine)
        async with AsyncSession(engine) as db:
            db.add(AccountFile(user_id=1, sha256=SHA, kind="epub", ext="epub", size=10, created_at=utcnow() - timedelta(days=2)))
            await db.commit()
        await engine.dispose()

    import asyncio

    try:
        with mock_aws():
            s3 = boto3.client("s3", region_name="us-east-1")
            s3.create_bucket(Bucket=BUCKET)
            s3.put_object(Bucket=BUCKET, Key=object_key(1, SHA, "epub", "epub"), Body=b"x" * 10)
            asyncio.run(seed())

            assert files_gc.main(["--dry-run"]) == 0
            assert json.loads(capsys.readouterr().out.strip().splitlines()[-1])["dryRun"] is True
            assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 1

            assert files_gc.main([]) == 0
            out = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
            # Sem a conta 1, o objeto sai pela linha pendente (e não de novo na varredura das contas apagadas).
            assert out["pending"] == 1 and out["errors"] == 0
            assert s3.list_objects_v2(Bucket=BUCKET).get("KeyCount") == 0
    finally:
        get_account_settings.cache_clear()


def test_the_systemd_units_run_this_module_every_day():
    from pathlib import Path

    units = Path(__file__).resolve().parents[1] / "deploy" / "systemd"
    service = (units / "oghma-accounts-files-gc.service").read_text()
    timer = (units / "oghma-accounts-files-gc.timer").read_text()
    assert "Type=oneshot" in service and "-m oghma.accounts.files_gc" in service
    assert "PYTHONPATH=/opt/oghma/accounts/backend/src" in service
    assert "OnCalendar=*-*-* " in timer and "WantedBy=timers.target" in timer
