"""Rede social da conta: amigos, bloqueios, conversas, indicações e o feed (SQLite em memória)."""
from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import StaticPool

from oghma.accounts.app import create_app, create_schema
from oghma.accounts.config import AccountSettings
from oghma.accounts.mailer import LogMailer
from oghma.accounts.models import AccountActivity, AccountBlock, AccountFriendship, AccountMessage
from oghma.accounts.profile import AVATAR_COLORS, AVATAR_IDS

from .test_accounts import SECRET, auth, entry


@pytest.fixture
async def api():
    settings = AccountSettings(database_url="sqlite+aiosqlite://", secret=SECRET, ip_requests_per_10min=1000)
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    await create_schema(engine)
    mailer = LogMailer()
    transport = httpx.ASGITransport(app=create_app(settings, mailer, engine))
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        client.mailer = mailer  # type: ignore[attr-defined]
        client.engine = engine  # type: ignore[attr-defined]
        yield client
    await engine.dispose()


async def person(api, nickname: str) -> tuple[str, str]:
    """Cria a conta com apelido e avatar. Devolve (token, publicId)."""
    email = f"{nickname}@example.com"
    await api.post("/v1/auth/code", json={"email": email})
    code = [sent for sent in api.mailer.sent if sent[0] == email][-1][1]
    body = (await api.post("/v1/auth/verify", json={"email": email, "code": code})).json()
    token = body["token"]
    patched = await api.patch("/v1/me", headers=auth(token), json={"nickname": nickname, "avatarId": AVATAR_IDS[0], "avatarColor": AVATAR_COLORS[0]})
    assert patched.status_code == 200, patched.text
    return token, body["user"]["publicId"]


async def befriend(api, a: tuple[str, str], b: tuple[str, str], b_nickname: str) -> None:
    assert (await api.post("/v1/friends/requests", headers=auth(a[0]), json={"nickname": b_nickname})).json() == {"status": "pending"}
    assert (await api.post(f"/v1/friends/{a[1]}/accept", headers=auth(b[0]))).json() == {"status": "accepted"}


async def cursor(api, token: str) -> int:
    return (await api.get("/v1/me", headers=auth(token))).json()["socialCursor"]


def now_ms() -> int:
    return int(time.time() * 1000)


async def count(api, model, *where) -> int:
    async with AsyncSession(api.engine) as db:
        return (await db.execute(select(func.count()).select_from(model).where(*where))).scalar_one()


async def test_request_accept_message_and_read(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    me = (await api.get("/v1/me", headers=auth(ana[0]))).json()
    assert me["libraryVisible"] is True and me["activityVisible"] is True and me["socialCursor"] == 0

    found = (await api.get("/v1/users/BÍA", headers=auth(ana[0]))).json()
    assert found == {"publicId": bia[1], "nickname": "bia", "avatarId": AVATAR_IDS[0], "avatarColor": AVATAR_COLORS[0]}

    bia_before = await cursor(api, bia[0])
    assert (await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})).json() == {"status": "pending"}
    assert await cursor(api, bia[0]) > bia_before
    lists = (await api.get("/v1/friends", headers=auth(bia[0]))).json()
    assert [r["publicId"] for r in lists["incoming"]] == [ana[1]] and lists["friends"] == [] and "requestedAt" in lists["incoming"][0]
    assert [r["publicId"] for r in (await api.get("/v1/friends", headers=auth(ana[0]))).json()["outgoing"]] == [bia[1]]
    # Only the one who received the request accepts it.
    assert (await api.post(f"/v1/friends/{bia[1]}/accept", headers=auth(ana[0]))).status_code == 404

    ana_before, bia_before = await cursor(api, ana[0]), await cursor(api, bia[0])
    assert (await api.post(f"/v1/friends/{ana[1]}/accept", headers=auth(bia[0]))).json() == {"status": "accepted"}
    assert await cursor(api, ana[0]) > ana_before and await cursor(api, bia[0]) > bia_before
    friends = (await api.get("/v1/friends", headers=auth(ana[0]))).json()
    assert [f["publicId"] for f in friends["friends"]] == [bia[1]] and friends["friends"][0]["since"]
    again = await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})
    assert again.status_code == 409 and again.json()["error"] == "already_friends"

    bia_before = await cursor(api, bia[0])
    sent = await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "  oi!  "})
    assert sent.status_code == 200, sent.text
    message = sent.json()
    assert message["from"] == ana[1] and message["to"] == bia[1] and message["body"] == "oi!"
    assert message["readAt"] is None and message["noteStatus"] is None
    assert await cursor(api, bia[0]) > bia_before
    await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "tudo bem?"})
    await api.post(f"/v1/conversations/{ana[1]}/messages", headers=auth(bia[0]), json={"body": "tudo!"})
    await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "que bom"})

    convs = (await api.get("/v1/conversations", headers=auth(bia[0]))).json()
    assert len(convs) == 1 and convs[0]["friend"]["publicId"] == ana[1]
    assert convs[0]["last"]["body"] == "que bom" and convs[0]["unread"] == 3

    page = (await api.get(f"/v1/conversations/{ana[1]}/messages", params={"limit": 2}, headers=auth(bia[0]))).json()
    assert [m["body"] for m in page["messages"]] == ["tudo!", "que bom"] and page["more"] is True
    older = (await api.get(f"/v1/conversations/{ana[1]}/messages", params={"before": page["messages"][0]["id"]}, headers=auth(bia[0]))).json()
    assert [m["body"] for m in older["messages"]] == ["oi!", "tudo bem?"] and older["more"] is False

    ana_before = await cursor(api, ana[0])
    assert (await api.post(f"/v1/conversations/{ana[1]}/read", headers=auth(bia[0]))).json() == {"unread": 0}
    assert await cursor(api, ana[0]) > ana_before, "the sender sees the read receipt"
    assert (await api.get("/v1/conversations", headers=auth(bia[0]))).json()[0]["unread"] == 0
    seen = (await api.get(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]))).json()["messages"]
    assert seen[0]["readAt"] is not None and seen[2]["readAt"] is None, "her own reply stays unread until Ana reads it"
    assert (await api.get("/v1/conversations", headers=auth(ana[0]))).json()[0]["unread"] == 1


async def test_messages_need_text_or_a_book_and_stay_short(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    url = f"/v1/conversations/{bia[1]}/messages"
    assert (await api.post(url, headers=auth(ana[0]), json={"body": "   "})).json()["error"] == "empty_message"
    assert (await api.post(url, headers=auth(ana[0]), json={"body": "x" * 2001})).json()["error"] == "message_too_long"
    assert (await api.post(url, headers=auth(ana[0]), json={"body": "x" * 2000})).status_code == 200


async def test_crossed_requests_become_a_friendship(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    assert (await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})).json() == {"status": "pending"}
    assert (await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})).json() == {"status": "pending"}
    assert (await api.post("/v1/friends/requests", headers=auth(bia[0]), json={"nickname": "ana"})).json() == {"status": "accepted"}
    assert [f["publicId"] for f in (await api.get("/v1/friends", headers=auth(bia[0]))).json()["friends"]] == [ana[1]]
    assert await count(api, AccountFriendship) == 1


async def test_declining_cancelling_and_unfriending(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})
    assert (await api.delete(f"/v1/friends/{ana[1]}", headers=auth(bia[0]))).status_code == 204  # recusa
    assert (await api.get("/v1/friends", headers=auth(ana[0]))).json()["outgoing"] == []
    await befriend(api, ana, bia, "bia")
    assert (await api.delete(f"/v1/friends/{bia[1]}", headers=auth(ana[0]))).status_code == 204
    assert (await api.get("/v1/friends", headers=auth(bia[0]))).json()["friends"] == []
    assert (await api.get(f"/v1/friends/{ana[1]}/library", headers=auth(bia[0]))).status_code == 403


async def test_unknown_self_and_missing_nicknames_are_not_found(api):
    ana = await person(api, "ana")
    assert (await api.get("/v1/users/ninguem", headers=auth(ana[0]))).json() == {"error": "not_found"}
    assert (await api.get("/v1/users/ana", headers=auth(ana[0]))).status_code == 404
    assert (await api.get("/v1/users/a", headers=auth(ana[0]))).status_code == 404
    assert (await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "ninguem"})).status_code == 404
    assert (await api.get("/v1/users/ana")).status_code == 401


async def test_blocking_hides_the_nickname_and_cuts_messages_and_profile(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"novelId": "cn:1", "snapshot": {"title": "Livro"}})

    assert (await api.post(f"/v1/blocks/{ana[1]}", headers=auth(bia[0]))).status_code == 204
    assert [b["publicId"] for b in (await api.get("/v1/blocks", headers=auth(bia[0]))).json()] == [ana[1]]
    # Neither finds the other; the friendship is gone, and with it messages and the profile.
    assert (await api.get("/v1/users/bia", headers=auth(ana[0]))).status_code == 404
    assert (await api.get("/v1/users/ana", headers=auth(bia[0]))).status_code == 404
    assert (await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})).status_code == 404
    assert (await api.get("/v1/friends", headers=auth(ana[0]))).json()["friends"] == []
    blocked_send = await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "oi"})
    assert blocked_send.status_code == 403 and blocked_send.json()["error"] == "not_friends"
    assert (await api.get(f"/v1/friends/{bia[1]}/library", headers=auth(ana[0]))).status_code == 403
    assert (await api.get("/v1/conversations", headers=auth(bia[0]))).json() == []
    assert (await api.get("/v1/recommendations", headers=auth(bia[0]))).json() == []

    assert (await api.delete(f"/v1/blocks/{ana[1]}", headers=auth(bia[0]))).status_code == 204
    assert (await api.get("/v1/users/bia", headers=auth(ana[0]))).status_code == 200
    assert (await api.get("/v1/friends", headers=auth(ana[0]))).json()["friends"] == [], "unblocking does not restore the friendship"


async def test_strangers_get_403(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})  # pending is not friends
    for response in [
        await api.get(f"/v1/friends/{bia[1]}/library", headers=auth(ana[0])),
        await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "oi"}),
        await api.get(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0])),
    ]:
        assert response.status_code == 403 and response.json() == {"error": "not_friends"}
    assert (await api.get("/v1/friends/nao-existe/library", headers=auth(ana[0]))).status_code == 404


async def test_private_books_stay_out_of_the_profile_and_the_feed(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    t = now_ms()
    snapshot = {"title": "Shadow Slave", "coverUrl": "https://c/1.jpg"}
    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [
        entry("cn:1", t, readingStatus="reading", snapshot=snapshot, addedAt=t),
        entry("cn:2", t, readingStatus="reading", private=True),
        entry("cn:3", t, deletedAt=t),
        entry("cn:4", t, onShelf=False, rating=4),
        # Old changes (a first sync of an existing library) do not flood the feed.
        entry("cn:5", t - 3 * 24 * 3600 * 1000, readingStatus="completed"),
    ]})
    pulled = {e["key"]: e for e in (await api.get("/v1/me/library", headers=auth(ana[0]))).json()["entries"]}
    assert pulled["novel:cn:2"]["private"] is True and pulled["novel:cn:1"]["private"] is False

    library = (await api.get(f"/v1/friends/{ana[1]}/library", headers=auth(bia[0]))).json()
    assert library["hidden"] is False
    assert sorted(e["novelId"] for e in library["entries"]) == ["cn:1", "cn:5"]
    first = next(e for e in library["entries"] if e["novelId"] == "cn:1")
    assert first == {"novelId": "cn:1", "favorite": False, "readingStatus": "reading", "rating": None, "addedAt": t,
                     "changedAt": t, "snapshot": {"novelId": "cn:1", "title": "Shadow Slave", "coverUrl": "https://c/1.jpg"}}

    feed = (await api.get("/v1/feed", headers=auth(bia[0]))).json()
    assert {(i["novelId"], i["kind"]) for i in feed["items"]} == {("cn:1", "added"), ("cn:1", "started"), ("cn:4", "rated")}
    assert all(i["user"]["publicId"] == ana[1] for i in feed["items"]) and feed["more"] is False
    assert next(i for i in feed["items"] if i["kind"] == "rated")["rating"] == 4
    assert "rating" not in next(i for i in feed["items"] if i["kind"] == "started")

    # Finishing, rating and dropping show up; marking the book private later removes its old activity.
    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [
        entry("cn:1", t + 1, readingStatus="completed", rating=5),
    ]})
    kinds = [i["kind"] for i in (await api.get("/v1/feed", headers=auth(bia[0]))).json()["items"] if i["novelId"] == "cn:1"]
    assert sorted(kinds) == ["added", "finished", "rated", "started"]
    page = (await api.get("/v1/feed", params={"limit": 2}, headers=auth(bia[0]))).json()
    assert len(page["items"]) == 2 and page["more"] is True
    rest = (await api.get("/v1/feed", params={"before": page["items"][-1]["id"]}, headers=auth(bia[0]))).json()
    assert len(rest["items"]) == 3 and rest["more"] is False

    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [entry("cn:1", t + 2, readingStatus="dropped", private=True)]})
    assert [i["novelId"] for i in (await api.get("/v1/feed", headers=auth(bia[0]))).json()["items"]] == ["cn:4"]

    # Turning activity off hides it and stops recording.
    await api.patch("/v1/me", headers=auth(ana[0]), json={"activityVisible": False})
    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [entry("cn:6", t + 3)]})
    assert (await api.get("/v1/feed", headers=auth(bia[0]))).json()["items"] == []
    await api.patch("/v1/me", headers=auth(ana[0]), json={"activityVisible": True})
    assert [i["novelId"] for i in (await api.get("/v1/feed", headers=auth(bia[0]))).json()["items"]] == ["cn:4"]


async def test_hidden_library(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [entry("cn:1", now_ms())]})
    me = (await api.patch("/v1/me", headers=auth(ana[0]), json={"libraryVisible": False})).json()
    assert me["libraryVisible"] is False and me["activityVisible"] is True
    assert (await api.get(f"/v1/friends/{ana[1]}/library", headers=auth(bia[0]))).json() == {"hidden": True, "entries": []}


async def test_only_the_recipient_changes_a_recommendation(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    url = f"/v1/conversations/{bia[1]}/messages"
    rec = (await api.post(url, headers=auth(ana[0]), json={
        "body": "", "novelId": "novel:cn:9", "snapshot": {"title": "Livro", "coverUrl": "http://inseguro"},
    })).json()
    assert rec["novelId"] == "cn:9" and rec["noteStatus"] == "new" and rec["snapshot"] == {"novelId": "cn:9", "title": "Livro"}
    text = (await api.post(url, headers=auth(ana[0]), json={"body": "e esse?"})).json()

    recs = (await api.get("/v1/recommendations", params={"status": "new"}, headers=auth(bia[0]))).json()
    assert [r["id"] for r in recs] == [rec["id"]] and recs[0]["fromUser"]["publicId"] == ana[1]
    assert (await api.get("/v1/recommendations", headers=auth(ana[0]))).json() == [], "only received ones"

    refused = await api.patch(f"/v1/messages/{rec['id']}", headers=auth(ana[0]), json={"noteStatus": "added"})
    assert refused.status_code == 404, "the sender cannot change it"
    assert (await api.patch(f"/v1/messages/{rec['id']}", headers=auth(bia[0]), json={"noteStatus": "new"})).status_code == 400
    assert (await api.patch(f"/v1/messages/{text['id']}", headers=auth(bia[0]), json={"noteStatus": "added"})).json()["error"] == "not_a_recommendation"

    ana_before = await cursor(api, ana[0])
    changed = (await api.patch(f"/v1/messages/{rec['id']}", headers=auth(bia[0]), json={"noteStatus": "added"})).json()
    assert changed["noteStatus"] == "added" and changed["from"] == ana[1]
    assert await cursor(api, ana[0]) > ana_before
    assert (await api.get("/v1/recommendations", params={"status": "new"}, headers=auth(bia[0]))).json() == []
    assert [r["noteStatus"] for r in (await api.get("/v1/recommendations", params={"status": "all"}, headers=auth(bia[0]))).json()] == ["added"]


async def test_wait_answers_a_social_event(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    start = await cursor(api, bia[0])
    idle = (await api.get("/v1/me/wait", params={"library": 0, "social": start, "timeout": 1}, headers=auth(bia[0]))).json()
    assert idle == {"library": {"changed": False, "cursor": 0}, "social": {"changed": False, "cursor": start}}

    waiting = asyncio.create_task(api.get("/v1/me/wait", params={"library": 0, "social": start, "timeout": 10}, headers=auth(bia[0])))
    await asyncio.sleep(0.3)
    assert not waiting.done()
    await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})
    answer = (await asyncio.wait_for(waiting, 5)).json()
    assert answer["social"]["changed"] is True and answer["social"]["cursor"] > start
    assert answer["library"] == {"changed": False, "cursor": 0}

    # The library side still answers too.
    await api.post("/v1/me/library/changes", headers=auth(bia[0]), json={"changes": [entry("cn:1", now_ms())]})
    both = (await api.get("/v1/me/wait", params={"library": 0, "social": answer["social"]["cursor"], "timeout": 5}, headers=auth(bia[0]))).json()
    assert both["library"] == {"changed": True, "cursor": 1} and both["social"]["changed"] is False


async def test_friend_requests_are_rate_limited(api):
    # Default: 30 a day (a repeated request still counts).
    ana = await person(api, "ana")
    await person(api, "bia")
    statuses = [(await api.post("/v1/friends/requests", headers=auth(ana[0]), json={"nickname": "bia"})).status_code for _ in range(31)]
    assert statuses[:30] == [200] * 30 and statuses[30] == 429


async def test_deleting_the_account_clears_the_social_side(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    cris = await person(api, "cris")
    await befriend(api, ana, bia, "bia")
    await api.post("/v1/friends/requests", headers=auth(cris[0]), json={"nickname": "ana"})
    await api.post(f"/v1/blocks/{cris[1]}", headers=auth(ana[0]))
    await api.post(f"/v1/blocks/{ana[1]}", headers=auth(cris[0]))
    await api.post(f"/v1/conversations/{bia[1]}/messages", headers=auth(ana[0]), json={"body": "oi", "novelId": "cn:1"})
    await api.post(f"/v1/conversations/{ana[1]}/messages", headers=auth(bia[0]), json={"body": "oi!"})
    await api.post("/v1/me/library/changes", headers=auth(ana[0]), json={"changes": [entry("cn:1", now_ms(), readingStatus="reading")]})
    assert await count(api, AccountActivity) > 0

    bia_before = await cursor(api, bia[0])
    assert (await api.delete("/v1/me", headers=auth(ana[0]))).status_code == 204
    assert await cursor(api, bia[0]) > bia_before
    assert await count(api, AccountFriendship) == 0
    assert await count(api, AccountBlock) == 0
    assert await count(api, AccountMessage) == 0
    assert await count(api, AccountActivity) == 0
    assert (await api.get("/v1/friends", headers=auth(bia[0]))).json() == {"friends": [], "incoming": [], "outgoing": []}
    assert (await api.get("/v1/users/ana", headers=auth(bia[0]))).status_code == 404


async def test_old_user_tables_gain_the_social_columns():
    from sqlalchemy import inspect, text
    from sqlalchemy.ext.asyncio import create_async_engine
    from sqlalchemy.pool import StaticPool

    from oghma.accounts.app import create_schema

    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    async with engine.begin() as conn:
        await conn.execute(text(
            "CREATE TABLE account_user (id INTEGER PRIMARY KEY, email VARCHAR(320), public_id VARCHAR(24), nickname VARCHAR(32), "
            "nickname_key VARCHAR(32), nickname_changed_at DATETIME, avatar_id VARCHAR(32), avatar_color VARCHAR(16), "
            "library_seq BIGINT, created_at DATETIME)"
        ))
        await conn.execute(text("INSERT INTO account_user (id, email, public_id, library_seq) VALUES (1, 'a@b.c', 'p1', 0)"))
    await create_schema(engine)
    await create_schema(engine)  # idempotent
    async with engine.connect() as conn:
        columns = await conn.run_sync(lambda sync: {c["name"] for c in inspect(sync).get_columns("account_user")})
        row = (await conn.execute(text("SELECT social_seq, library_visible, activity_visible FROM account_user"))).one()
    assert {"social_seq", "library_visible", "activity_visible"} <= columns
    assert tuple(row) == (0, 1, 1)
    await engine.dispose()
