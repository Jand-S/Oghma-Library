"""Testes de parsing do conector Golden Novel contra payloads WordPress."""
import asyncio
import json

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.golden_novel import GoldenNovelConnector


def json_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False).encode("utf-8")


CATEGORIES = json_bytes([
    {
        "id": 10,
        "name": "Xianxia",
        "slug": "xianxia",
        "count": 0,
        "parent": 0,
        "link": "https://goldennovel.com/index.php/category/xianxia/",
        "description": "",
    },
    {
        "id": 150,
        "name": "Scattered Immortal in a Chaotic World",
        "slug": "scattered-immortal-in-a-chaotic-world",
        "count": 2,
        "parent": 10,
        "link": "https://goldennovel.com/index.php/category/xianxia/scattered-immortal-in-a-chaotic-world/",
        "description": "Author: Guo Me\nA gang leader travels to a cultivation world.",
    },
])

NOVEL_PAGE = b"""
<html><body>
  <div id="description">
    <div class="cover">
      <img src="https://goldennovel.com/wp-content/themes/wpnovo-dist/cache/cover.jpeg">
    </div>
  </div>
</body></html>
"""

POSTS = json_bytes([
    {
        "id": 1001,
        "slug": "chapter-1-transmigration",
        "link": "https://goldennovel.com/index.php/xianxia/scattered-immortal-in-a-chaotic-world/chapter-1-transmigration/",
        "title": {"rendered": "Chapter 1: Transmigration"},
        "date": "2026-06-20T10:00:00",
    },
    {
        "id": 1002,
        "slug": "chapter-2-soul-snatching-demon",
        "link": "https://goldennovel.com/index.php/xianxia/scattered-immortal-in-a-chaotic-world/chapter-2-soul-snatching-demon/",
        "title": {"rendered": "Chapter 2: Soul-Snatching Demon"},
        "date": "2026-06-20T11:00:00",
    },
])

CHAPTER = json_bytes({
    "id": 1001,
    "slug": "chapter-1-transmigration",
    "link": "https://goldennovel.com/index.php/xianxia/scattered-immortal-in-a-chaotic-world/chapter-1-transmigration/",
    "title": {"rendered": "Chapter 1: Transmigration"},
    "content": {
        "rendered": (
            "<p>Chapter 1: Transmigration</p>"
            "<script>tracker()</script>"
            "<p>The first paragraph.</p>"
            "<p><strong>The second</strong> paragraph.</p>"
        )
    },
    "date": "2026-06-20T10:00:00",
})


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=self.pages[url], content_type="application/json")


def test_discover_novels_reads_child_categories_only():
    connector = GoldenNovelConnector()
    pages = {
        connector._api_url("categories?per_page=100&page=1&_fields=id,name,slug,count,parent,link,description"): CATEGORIES,
    }

    refs = asyncio.run(connector.discover_novels(FakeFetcher(pages)))

    assert len(refs) == 1
    assert refs[0].slug == "scattered-immortal-in-a-chaotic-world"
    assert refs[0].url.endswith("/category/xianxia/scattered-immortal-in-a-chaotic-world/")
    assert connector.expected_total_from_listing(CATEGORIES) == 1


def test_fetch_novel_sets_english_language_cover_author_and_genre():
    connector = GoldenNovelConnector()
    fetcher = FakeFetcher({
        connector._api_url("categories?per_page=100&page=1&_fields=id,name,slug,count,parent,link,description"): CATEGORIES,
        "https://goldennovel.com/index.php/category/xianxia/scattered-immortal-in-a-chaotic-world/": NOVEL_PAGE,
    })
    ref = asyncio.run(connector.discover_novels(fetcher))[0]

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.title == "Scattered Immortal in a Chaotic World"
    assert meta.cover_url == "https://goldennovel.com/wp-content/themes/wpnovo-dist/cache/cover.jpeg"
    assert meta.author == "Guo Me"
    assert meta.tags == ["Xianxia"]
    assert meta.language == "en"
    assert meta.source_chapter_count == 2
    assert meta.extra["golden_novel_category_id"] == 150


def test_list_chapters_uses_wordpress_post_api_urls():
    connector = GoldenNovelConnector()
    fetcher = FakeFetcher({
        connector._api_url("categories?per_page=100&page=1&_fields=id,name,slug,count,parent,link,description"): CATEGORIES,
        "https://goldennovel.com/index.php/category/xianxia/scattered-immortal-in-a-chaotic-world/": NOVEL_PAGE,
        connector._api_url("posts?categories=150&per_page=100&page=1&orderby=date&order=asc&_fields=id,slug,link,title,date"): POSTS,
    })
    ref = asyncio.run(connector.discover_novels(fetcher))[0]
    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [1.0, 2.0]
    assert chapters[0].title == "Chapter 1: Transmigration"
    assert chapters[0].url == connector._post_api_url(1001)
    assert chapters[0].published_at == "2026-06-20T10:00:00"


def test_normalize_chapter_reads_post_content_json():
    connector = GoldenNovelConnector()

    raw = RawPage(url=connector._post_api_url(1001), html=CHAPTER, content_type="application/json")
    norm = connector.normalize_chapter(raw)

    assert norm.title == "Chapter 1: Transmigration"
    assert "tracker" not in norm.html
    assert "<p>The first paragraph.</p>" in norm.html
    assert "<p><strong>The second</strong> paragraph.</p>" in norm.html
    assert norm.word_count == 9
