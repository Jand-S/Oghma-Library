import asyncio
from types import SimpleNamespace

from oghma.publish.reader import merge_moved
from oghma.publish.records import NovelRecord
from oghma.scraper.base import NovelRef
from oghma.scraper.moved import redirect_target


def rec(id, first, moved_to=None):
    return NovelRecord(id=id, source_id="central-novel", slug=id.split(":")[1], title="Shadow Slave", author=None,
                       description=None, cover_path=None, language="pt-BR", status="ongoing", tags=[], tag_keys=[],
                       updated_at=None, extra={"moved_to": moved_to} if moved_to else {}, first_seen_at=first)


def test_moved_novel_leaves_the_catalog_and_hands_its_id_and_arrival_to_the_new_one():
    old = rec("central-novel:shadow-slave-20230928", "2026-06-16T00:00:00", moved_to="central-novel:shadow-slave-20260913")
    new = rec("central-novel:shadow-slave-20260913", "2026-10-04T00:00:00")
    other = rec("central-novel:lotm", "2026-06-17T00:00:00", moved_to="central-novel:missing")
    out = merge_moved([old, new, other])
    assert [n.id for n in out] == ["central-novel:shadow-slave-20260913", "central-novel:lotm"]
    assert new.aliases == ["central-novel:shadow-slave-20230928"]
    assert new.first_seen_at == "2026-06-16T00:00:00"


def test_redirect_target_reads_the_location_without_following_it():
    class Client:
        async def get(self, url, follow_redirects):
            assert follow_redirects is False
            if "20230928" in url:
                return SimpleNamespace(status_code=301, headers={"Location": "/series/shadow-slave-20260913/"})
            return SimpleNamespace(status_code=200, headers={})

    async def throttle(host):
        return None

    fetcher = SimpleNamespace(_client=Client(), _throttle=throttle, use_curl=False)
    assert asyncio.run(redirect_target(fetcher, "https://centralnovel.com/series/shadow-slave-20230928/")) == \
        "https://centralnovel.com/series/shadow-slave-20260913/"
    assert asyncio.run(redirect_target(fetcher, "https://centralnovel.com/series/shadow-slave-20260913/")) is None
    assert asyncio.run(redirect_target(SimpleNamespace(use_curl=True, _client=Client()), "https://x/")) is None
