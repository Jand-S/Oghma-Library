"""Conta Oghma: login por código, perfil e a biblioteca sincronizada (SQLite em memória)."""
from __future__ import annotations

from datetime import timedelta

import httpx
import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

from oghma.accounts import service
from oghma.accounts.app import create_app, create_schema
from oghma.accounts.config import AccountSettings
from oghma.accounts.mailer import LogMailer, code_email
from oghma.accounts.profile import AVATAR_COLORS, AVATAR_IDS, nickname_key, nickname_problem

SECRET = "s" * 40


@pytest.fixture
async def api():
    settings = AccountSettings(database_url="sqlite+aiosqlite://", secret=SECRET, ip_requests_per_10min=1000)
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    await create_schema(engine)
    mailer = LogMailer()
    app = create_app(settings, mailer, engine)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        client.mailer = mailer  # type: ignore[attr-defined]
        client.settings = settings  # type: ignore[attr-defined]
        yield client
    await engine.dispose()


async def login(api, email="leitor@example.com", device="MacBook") -> tuple[str, dict]:
    response = await api.post("/v1/auth/code", json={"email": email})
    assert response.status_code == 202, response.text
    code = api.mailer.sent[-1][1]
    response = await api.post("/v1/auth/verify", json={"email": email, "code": code, "deviceName": device, "platform": "macos"})
    assert response.status_code == 200, response.text
    body = response.json()
    return body["token"], body


def auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def entry(novel_id: str, changed_at: int, **fields):
    return {"key": f"novel:{novel_id}", "changedAt": changed_at, "readingStatus": "unread", "tags": [], "onShelf": True, **fields}


async def test_first_login_creates_the_account_and_asks_for_a_profile(api):
    token, body = await login(api, "  Leitor@Example.com ")
    assert body["created"] is True
    assert body["user"]["email"] == "leitor@example.com"
    assert body["user"]["needsProfile"] is True
    me = (await api.get("/v1/me", headers=auth(token))).json()
    assert me["publicId"] == body["user"]["publicId"]

    # Second login on another device: same account, no new profile step once it is filled.
    await api.patch("/v1/me", headers=auth(token), json={"nickname": "Jandson", "avatarId": AVATAR_IDS[0], "avatarColor": AVATAR_COLORS[0]})
    api.mailer.sent.clear()
    token2, body2 = await login(api, "leitor@example.com", "PC Windows")
    assert body2["created"] is False and body2["user"]["needsProfile"] is False
    sessions = (await api.get("/v1/me/sessions", headers=auth(token2))).json()["sessions"]
    assert {s["deviceName"] for s in sessions} == {"MacBook", "PC Windows"}
    assert [s["current"] for s in sessions if s["deviceName"] == "PC Windows"] == [True]


async def test_codes_expire_lock_after_attempts_and_wait_before_resending(api):
    assert (await api.post("/v1/auth/code", json={"email": "não-é-email"})).json()["error"] == "invalid_email"
    await api.post("/v1/auth/code", json={"email": "a@example.com"})
    again = await api.post("/v1/auth/code", json={"email": "a@example.com"})
    assert again.status_code == 429 and again.json()["error"] == "too_soon" and again.json()["retryAfter"] > 0

    wrong = await api.post("/v1/auth/verify", json={"email": "a@example.com", "code": "000000"})
    if api.mailer.sent[-1][1] == "000000":  # sorte rara: o código sorteado era esse
        return
    assert wrong.json() == {"error": "invalid_code", "attemptsLeft": 4}
    for _ in range(4):
        last = await api.post("/v1/auth/verify", json={"email": "a@example.com", "code": "000000"})
    assert last.status_code == 429 and last.json()["error"] == "too_many_attempts"
    right = await api.post("/v1/auth/verify", json={"email": "a@example.com", "code": api.mailer.sent[-1][1]})
    assert right.json()["error"] == "too_many_attempts"


async def test_expired_code(api):
    settings = api.settings
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    await create_schema(engine)
    from sqlalchemy.ext.asyncio import AsyncSession

    async with AsyncSession(engine) as db:
        login = await service.request_code(db, settings, "b@example.com")
        later = service.utcnow() + timedelta(seconds=settings.code_ttl_seconds + 1)
        with pytest.raises(service.AccountError) as error:
            await service.verify_code(db, settings, login.email, login.code, now=later)
        assert error.value.code == "expired_code"
    await engine.dispose()


async def test_old_code_tables_gain_the_link_columns():
    from sqlalchemy import inspect, text

    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.execute(text(
            "CREATE TABLE account_login_code (id INTEGER PRIMARY KEY, email VARCHAR(320), code_hash VARCHAR(64), "
            "attempts INTEGER, sent_at DATETIME, expires_at DATETIME, used_at DATETIME)"
        ))
    await create_schema(engine)
    await create_schema(engine)  # idempotent
    async with engine.connect() as conn:
        columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns("account_login_code")})
    assert {"login_id", "link_hash", "device_name", "platform", "approved_at"} <= columns
    await engine.dispose()


async def test_requests_without_a_valid_token_are_refused(api):
    assert (await api.get("/v1/me")).status_code == 401
    assert (await api.get("/v1/me", headers=auth("nope"))).status_code == 401
    token, _ = await login(api)
    assert (await api.post("/v1/auth/logout", headers=auth(token))).status_code == 204
    assert (await api.get("/v1/me", headers=auth(token))).status_code == 401


def test_nickname_rules():
    assert nickname_key("Jándson") == nickname_key("JANDSON") == "jandson"
    assert nickname_problem("ab") == "too_short"
    assert nickname_problem("a" * 21) == "too_long"
    assert nickname_problem("ja ndson") == "invalid_chars"
    assert nickname_problem("_jandson") == "invalid_chars"
    assert nickname_problem("jan..dson") == "invalid_chars"
    assert nickname_problem("Suporte") == "reserved"
    assert nickname_problem("leitora.de_novels") is None
    assert nickname_problem("João") is None


async def test_nicknames_are_unique_ignoring_case_and_accents(api):
    token_a, _ = await login(api, "a@example.com")
    api.mailer.sent.clear()
    token_b, _ = await login(api, "b@example.com")
    assert (await api.patch("/v1/me", headers=auth(token_a), json={"nickname": "Jandson"})).status_code == 200

    check = (await api.get("/v1/nicknames/jándson/available")).json()
    assert check["available"] is False and check["reason"] == "taken" and len(check["suggestions"]) == 3
    # The owner sees their own nickname as available.
    assert (await api.get("/v1/nicknames/JANDSON/available", headers=auth(token_a))).json()["available"] is True

    taken = await api.patch("/v1/me", headers=auth(token_b), json={"nickname": "JÁNDSON"})
    assert taken.status_code == 409 and taken.json()["error"] == "nickname_taken"
    bad = await api.patch("/v1/me", headers=auth(token_b), json={"avatarId": "nao-existe"})
    assert bad.json()["error"] == "invalid_avatar"


async def test_nickname_change_waits_30_days_but_case_changes_are_free(api):
    token, _ = await login(api)
    assert (await api.patch("/v1/me", headers=auth(token), json={"nickname": "leitor"})).status_code == 200
    assert (await api.patch("/v1/me", headers=auth(token), json={"nickname": "Leitor"})).status_code == 200
    soon = await api.patch("/v1/me", headers=auth(token), json={"nickname": "outro_nome"})
    assert soon.status_code == 429 and soon.json()["error"] == "nickname_cooldown" and "availableAt" in soon.json()


async def test_library_sync_newest_change_wins_with_tombstones_and_cursor(api):
    token, _ = await login(api)
    snapshot = {"title": "Shadow Slave", "sourceName": "Central Novel", "coverUrl": "https://c/1.jpg", "chapters": 2000}
    pushed = (await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [
        entry("cn:1", 100, rating=5, readingStatus="completed", favorite=True, snapshot=snapshot, hidden=True),
        entry("cn:2", 100, rating=9, readingStatus="weird", tags=["  a ", ""], snapshot={"title": "X", "coverUrl": "asset://local"}),
    ]})).json()
    assert pushed["accepted"] == [{"key": "novel:cn:1", "changedAt": 100}, {"key": "novel:cn:2", "changedAt": 100}]
    assert pushed["cursor"] == 2

    full = (await api.get("/v1/me/library", headers=auth(token))).json()
    first, second = full["entries"]
    assert first["rating"] == 5 and first["readingStatus"] == "completed" and first["favorite"] is True
    assert first["hidden"] is False, "hidden is per device"
    assert first["snapshot"]["title"] == "Shadow Slave"
    assert second["rating"] is None and second["readingStatus"] == "unread" and second["tags"] == ["a"]
    assert "coverUrl" not in second["snapshot"], "only https covers travel"

    # An older change loses; a newer one wins and keeps the snapshot it did not resend.
    result = (await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [
        entry("cn:1", 90, rating=1),
        entry("cn:2", 200, rating=4),
    ]})).json()
    assert result["rejected"] == ["novel:cn:1"]
    assert result["accepted"] == [{"key": "novel:cn:2", "changedAt": 200}]
    delta = (await api.get("/v1/me/library", params={"since": 2}, headers=auth(token))).json()
    assert [e["key"] for e in delta["entries"]] == ["novel:cn:2"]
    assert delta["entries"][0]["rating"] == 4 and delta["entries"][0]["snapshot"]["title"] == "X"
    assert delta["cursor"] == 3

    # Removal = tombstone (personal fields cleared), reaches the other devices by cursor.
    await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry("cn:1", 300, deletedAt=300, rating=5)]})
    tomb = (await api.get("/v1/me/library", params={"since": 3}, headers=auth(token))).json()["entries"][0]
    assert tomb["deletedAt"] == 300 and tomb["rating"] is None and tomb["onShelf"] is False


async def test_resending_the_same_change_is_confirmed_not_rejected(api):
    token, _ = await login(api)
    first = (await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry("cn:1", 100)]})).json()
    again = (await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry("cn:1", 100)]})).json()
    assert again["accepted"] == [{"key": "novel:cn:1", "changedAt": 100}] and again["rejected"] == []
    assert again["cursor"] == first["cursor"], "a resend does not create a new version"


async def test_wait_answers_at_once_when_something_changed_and_times_out_otherwise(api):
    token, _ = await login(api)
    idle = (await api.get("/v1/me/library/wait", params={"since": 0, "timeout": 1}, headers=auth(token))).json()
    assert idle == {"changed": False, "cursor": 0}
    await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry("cn:1", 100)]})
    changed = (await api.get("/v1/me/library/wait", params={"since": 0, "timeout": 5}, headers=auth(token))).json()
    assert changed == {"changed": True, "cursor": 1}


async def test_library_rejects_bad_keys_and_huge_batches(api):
    token, _ = await login(api)
    bad = await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [{"key": "/out/Livro", "changedAt": 1}]})
    assert bad.json()["error"] == "invalid_entry"
    huge = await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry(f"cn:{i}", 1) for i in range(501)]})
    assert huge.status_code == 413


async def test_deleting_the_account_removes_everything(api):
    token, _ = await login(api)
    await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [entry("cn:1", 1)]})
    assert (await api.delete("/v1/me", headers=auth(token))).status_code == 204
    assert (await api.get("/v1/me", headers=auth(token))).status_code == 401
    api.mailer.sent.clear()
    token2, body = await login(api)
    assert body["created"] is True
    assert (await api.get("/v1/me/library", headers=auth(token2))).json()["entries"] == []


def test_code_email_has_the_button_the_code_on_one_line_and_the_logo():
    subject, text, html = code_email("123456", "https://conta.oghma.dev/entrar/abc", "https://conta.oghma.dev/marca/oghma.png")
    assert subject.startswith("123456")
    assert "123456" in text and "https://conta.oghma.dev/entrar/abc" in text
    assert 'href="https://conta.oghma.dev/entrar/abc"' in html and "Entrar no Oghma" in html
    # Digits joined by word joiners (no line break, no phone-number link), in two groups.
    assert "1&#8288;2&#8288;3" in html and "4&#8288;5&#8288;6" in html
    assert "white-space:nowrap" in html and 'name="format-detection"' in html
    assert html.count("<img") == 1 and "/marca/oghma.png" in html


async def test_the_email_button_signs_in_the_waiting_app_after_a_confirmation(api):
    code = await api.post("/v1/auth/code", json={"email": "link@example.com", "deviceName": "MacBook", "platform": "macos"})
    login_id = code.json()["loginId"]
    link = api.mailer.sent[-1][2]
    path = "/" + link.split("/", 3)[3]

    waiting = await api.post("/v1/auth/poll", json={"email": "link@example.com", "loginId": login_id})
    assert waiting.status_code == 202
    # Opening the link (or a mail scanner prefetching it) approves nothing.
    page = await api.get(path)
    assert page.status_code == 200 and "Confirmar e entrar" in page.text and "MacBook" in page.text
    assert (await api.post("/v1/auth/poll", json={"email": "link@example.com", "loginId": login_id})).status_code == 202
    assert "default-src 'none'" in page.headers["content-security-policy"]

    done = await api.post(path)
    assert "Pronto" in done.text
    signed = await api.post("/v1/auth/poll", json={"email": "link@example.com", "loginId": login_id})
    assert signed.status_code == 200
    token = signed.json()["token"]
    assert signed.json()["created"] is True
    sessions = (await api.get("/v1/me/sessions", headers=auth(token))).json()["sessions"]
    assert sessions[0]["deviceName"] == "MacBook"

    # One use: the link and the login are spent; the typed code no longer works either.
    assert (await api.post("/v1/auth/poll", json={"email": "link@example.com", "loginId": login_id})).status_code == 410
    assert "já foi usado" in (await api.get(path)).text
    assert (await api.post("/v1/auth/verify", json={"email": "link@example.com", "code": api.mailer.sent[-1][1]})).status_code == 400


async def test_a_wrong_login_id_or_link_gets_nothing(api):
    await api.post("/v1/auth/code", json={"email": "x@example.com"})
    assert (await api.post("/v1/auth/poll", json={"email": "x@example.com", "loginId": "chute"})).status_code == 410
    page = await api.get("/entrar/nao-existe")
    assert page.status_code == 410 and "expirou" in page.text


async def test_brand_files_are_served(api):
    logo = await api.get("/marca/oghma.png")
    assert logo.status_code == 200 and logo.headers["content-type"] == "image/png"
    bimi = await api.get("/marca/bimi.svg")
    assert 'baseProfile="tiny-ps"' in bimi.text


def test_the_app_needs_a_real_secret():
    with pytest.raises(RuntimeError):
        create_app(AccountSettings(secret="curto"), LogMailer(), create_async_engine("sqlite+aiosqlite://"))
