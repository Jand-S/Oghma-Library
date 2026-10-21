"""EPUBs importados na biblioteca da conta: chaves `import:<sha256>` (SQLite em memória)."""
from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oghma.accounts.library_entries import clean_entry, clean_snapshot
from oghma.accounts.models import AccountActivity, AccountLibraryEntry
from oghma.accounts.service import AccountError

from .test_accounts import auth, entry
from .test_social import api, befriend, count, now_ms, person  # noqa: F401 (fixture)

SHA = "ab" * 32
KEY = f"import:{SHA}"
SNAPSHOT = {
    "title": "Caged Sparrow",
    "author": "Alguém",
    "origin": "import",
    "language": "pt-BR",
    "series": {"id": "series:unsheathed", "name": "Unsheathed", "volume": 1},
    "fileSize": 1878579,
    "coverExt": "jpg",
}


def imported(changed_at: int, **fields):
    return {"key": KEY, "changedAt": changed_at, "readingStatus": "unread", "tags": [], "onShelf": True, **fields}


async def push(api, token: str, *changes) -> dict:
    response = await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": list(changes)})
    assert response.status_code == 200, response.text
    return response.json()


async def test_import_key_is_stored_whole_and_comes_back_the_same(api):
    token, _ = await person(api, "ana")
    pushed = await push(api, token, imported(100, snapshot=SNAPSHOT), entry("cn:1", 100))
    assert pushed["accepted"] == [{"key": KEY, "changedAt": 100}, {"key": "novel:cn:1", "changedAt": 100}]

    async with AsyncSession(api.engine) as db:
        stored = set((await db.execute(select(AccountLibraryEntry.novel_id))).scalars())
    assert stored == {KEY, "cn:1"}, "import keeps the whole key; novel: keeps only the id"

    pulled = {e["key"]: e for e in (await api.get("/v1/me/library", headers=auth(token))).json()["entries"]}
    assert set(pulled) == {KEY, "novel:cn:1"}
    assert pulled[KEY]["snapshot"] == {"novelId": KEY, **SNAPSHOT}
    assert pulled["novel:cn:1"]["private"] is False

    # An older change of the same file loses, by the same key.
    again = await push(api, token, imported(90, rating=2))
    assert again["rejected"] == [KEY] and again["accepted"] == []


@pytest.mark.parametrize(
    "key",
    [
        "import:",
        f"import:{SHA[:-1]}",
        f"import:{SHA}0",
        f"import:{SHA.upper()}",
        f"import:{'g' * 64}",
        f"import:{SHA}/x",
        f"novel:import:{SHA}",
        "novel:",
        "/out/Livro",
    ],
)
def test_bad_import_keys_are_refused(key):
    with pytest.raises(AccountError) as error:
        clean_entry({"key": key, "changedAt": 1})
    assert error.value.code == "invalid_entry"


async def test_bad_import_key_is_refused_by_the_route(api):
    token, _ = await person(api, "ana")
    bad = await api.post("/v1/me/library/changes", headers=auth(token), json={"changes": [{"key": "import:abc", "changedAt": 1}]})
    assert bad.status_code == 400 and bad.json()["error"] == "invalid_entry"


def test_import_entries_are_always_private_and_novel_entries_keep_the_choice():
    assert clean_entry(imported(1, private=False))[1]["private"] is True
    assert clean_entry(imported(1))[1]["private"] is True
    assert clean_entry(entry("cn:1", 1))[1]["private"] is False
    assert clean_entry(entry("cn:1", 1, private=True))[1]["private"] is True


def test_snapshot_import_fields_are_cleaned():
    good = clean_snapshot(KEY, SNAPSHOT)
    assert good == {"novelId": KEY, **SNAPSHOT}

    half = clean_snapshot(KEY, {**SNAPSHOT, "series": {"id": "series:x", "name": "X", "volume": 2.5}})
    assert half["series"] == {"id": "series:x", "name": "X", "volume": 2.5}
    long_name = clean_snapshot(KEY, {**SNAPSHOT, "series": {"id": "series:x", "name": "N" * 500}})
    assert long_name["series"] == {"id": "series:x", "name": "N" * 200}

    bad = clean_snapshot(KEY, {
        "title": "T",
        "origin": "catalog",
        "language": "   ",
        "series": {"name": "Sem id", "volume": 1},
        "fileSize": -5,
        "coverExt": "gif",
    })
    assert bad == {"novelId": KEY, "title": "T"}
    for series in ("Unsheathed", {"id": "s", "name": ""}, ["s", "n"]):
        assert "series" not in clean_snapshot(KEY, {"title": "T", "series": series})
    assert "fileSize" not in clean_snapshot(KEY, {"title": "T", "fileSize": True})
    assert "fileSize" not in clean_snapshot(KEY, {"title": "T", "fileSize": "123"})
    assert "volume" not in clean_snapshot(KEY, {"title": "T", "series": {"id": "series:s", "name": "n", "volume": "1"}})["series"]
    # Volume keeps one decimal at most, like the app shows it.
    for volume, kept in ((2.25, 2.2), (2.0, 2), (3.04, 3), (1.96, 2)):
        assert clean_snapshot(KEY, {"title": "T", "series": {"id": "series:s", "name": "n", "volume": volume}})["series"]["volume"] == kept
    # The id is `series:` + the slug the app makes (or the 12-hex fallback of a CJK-only name).
    for series_id in ("series:unsheathed", "series:the-wandering-inn-2", "series:0123456789ab"):
        assert clean_snapshot(KEY, {"title": "T", "series": {"id": series_id, "name": "n"}})["series"]["id"] == series_id
    for series_id in ("s", "series:", "series:Upper", "series:-x", "series:x-", "series:a--b", "series:a b", "novel:x", "series:x/y"):
        assert "series" not in clean_snapshot(KEY, {"title": "T", "series": {"id": series_id, "name": "n"}}), series_id
    for ext in ("jpg", "png", "webp"):
        assert clean_snapshot(KEY, {"title": "T", "coverExt": ext})["coverExt"] == ext

    # A catalog snapshot stays exactly as before.
    catalog = {"title": "Shadow Slave", "sourceName": "Central Novel", "coverUrl": "https://c/1.jpg", "chapters": 2000}
    assert clean_snapshot("cn:1", catalog) == {"novelId": "cn:1", **catalog}


async def test_imported_books_never_reach_friends_or_the_feed(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    t = now_ms()
    await push(api, ana[0],
               imported(t, readingStatus="reading", rating=5, private=False, snapshot=SNAPSHOT, addedAt=t),
               entry("cn:1", t, readingStatus="reading"))

    pulled = {e["key"]: e for e in (await api.get("/v1/me/library", headers=auth(ana[0]))).json()["entries"]}
    assert pulled[KEY]["private"] is True, "the server forces private on import entries"

    library = (await api.get(f"/v1/friends/{ana[1]}/library", headers=auth(bia[0]))).json()
    assert [e["novelId"] for e in library["entries"]] == ["cn:1"]
    feed = (await api.get("/v1/feed", headers=auth(bia[0]))).json()["items"]
    assert {i["novelId"] for i in feed} == {"cn:1"}
    assert await count(api, AccountActivity, AccountActivity.novel_id == KEY) == 0

    # Finishing it later still records nothing.
    await push(api, ana[0], imported(t + 1, readingStatus="completed", rating=4, private=False))
    assert await count(api, AccountActivity, AccountActivity.novel_id == KEY) == 0


async def test_a_stored_import_row_that_lost_private_stays_out_of_the_friend_library(api):
    ana = await person(api, "ana")
    bia = await person(api, "bia")
    await befriend(api, ana, bia, "bia")
    await push(api, ana[0], imported(now_ms(), snapshot=SNAPSHOT))
    async with AsyncSession(api.engine) as db:
        row = (await db.execute(select(AccountLibraryEntry).where(AccountLibraryEntry.novel_id == KEY))).scalar_one()
        row.data = {**row.data, "private": False}
        await db.commit()

    library = (await api.get(f"/v1/friends/{ana[1]}/library", headers=auth(bia[0]))).json()
    assert library["entries"] == []
    pulled = (await api.get("/v1/me/library", headers=auth(ana[0]))).json()["entries"]
    assert pulled[0]["key"] == KEY and pulled[0]["private"] is True
