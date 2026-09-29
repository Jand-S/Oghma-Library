"""Testes de parsing do conector RoliaScan."""
import asyncio
import json
from urllib.parse import parse_qs, urlparse

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.rolia_scan import RoliaScanConnector


DETAIL = b"""
<html>
  <head>
    <meta property="og:image" content="https://roliascan.com/content/media/manga-188862-cover.jpg">
    <meta property="og:description" content="Fallback synopsis.">
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Book",
        "name": "Unsheathed Novel | Read Online Free at roliascan.com",
        "description": "A sword story.",
        "image": "https://roliascan.com/content/media/manga-188862-cover.jpg",
        "inLanguage": "en_US",
        "author": {"@type": "Person", "name": "Feng Huo Xi Zhu Hou"},
        "genre": "Novel",
        "status": "Ongoing",
        "numberOfEpisodes": 1147,
        "datePublished": "2026-05-16T14:36:47+00:00",
        "dateModified": "2026-05-17T14:36:47+00:00"
      }
    </script>
  </head>
  <body>
    <h1>Unsheathed</h1>
    <button data-manga-id="188862"></button>
    <span class="view-info">5,070</span>
    <a href="/tag/action/">Action</a>
    <a href="/tag/xianxia/">Xianxia</a>
    <a href="/tag/action/">Action</a>
  </body>
</html>
"""

CHAPTER = b"""
<html>
  <head><meta property="og:title" content="Chapter 1 - Unsheathed"></head>
  <body>
    <nav>Previous</nav>
    <div class="reader-text px-4">
      <p>Chapter 1: Jingzhe</p>
      <p>The story starts here.</p>
      <script>track()</script>
    </div>
  </body>
</html>
"""


class FakeFetcher:
    def __init__(self) -> None:
        self.posts: list[tuple[str, dict]] = []
        self.get_json_urls: list[str] = []

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=DETAIL, content_type="text/html")

    async def post_json(self, url: str, payload: dict) -> object:
        self.posts.append((url, payload))
        page = payload["page"]
        if page == 1:
            return [
                {
                    "id": 188862,
                    "title": "Unsheathed",
                    "url": "https://roliascan.com/manga/unsheathed-novel/",
                    "type": "Novel",
                },
                {
                    "id": 1,
                    "title": "Comic",
                    "url": "https://roliascan.com/manga/comic/",
                    "type": "Manhwa",
                },
                {
                    "id": 2,
                    "title": "Another Novel",
                    "url": "https://roliascan.com/manga/another-novel/",
                    "type": "Novel",
                },
            ]
        return []

    async def get_json(self, url: str) -> object:
        self.get_json_urls.append(url)
        query = parse_qs(urlparse(url).query)
        assert query["manga_id"] == ["188862"]
        assert query["_t"][0]
        assert query["_ts"][0]
        offset = int(query["offset"][0])
        if offset == 0:
            return {
                "data": [
                    {"chapter": "1", "title": "Chapter 1", "url": "https://roliascan.com/read/unsheathed-novel/ch1-1", "date": "1 month ago"},
                    {"chapter": "1", "title": "Chapter 1.2", "url": "https://roliascan.com/read/unsheathed-novel/ch1-2", "date": "1 month ago"},
                ],
                "has_more": True,
            }
        return {
            "data": [
                {"chapter": "2", "title": "Chapter 2", "url": "https://roliascan.com/read/unsheathed-novel/ch2-3"},
            ],
            "has_more": False,
        }


def test_discover_prioritizes_unsheathed_and_filters_rest_payload():
    connector = RoliaScanConnector()
    fetcher = FakeFetcher()

    refs = asyncio.run(connector.discover_novels(fetcher))

    assert [ref.slug for ref in refs] == ["unsheathed-novel", "another-novel"]
    assert json.loads(fetcher.posts[0][1]["types"]) == ["Novel"]


def test_fetch_novel_parses_book_metadata_views_tags_and_language():
    connector = RoliaScanConnector()
    ref = connector.PRIORITY_REFS[0]

    meta = asyncio.run(connector.fetch_novel(FakeFetcher(), ref))

    assert meta.title == "Unsheathed"
    assert meta.cover_url == "https://roliascan.com/content/media/manga-188862-cover.jpg"
    assert meta.description == "A sword story."
    assert meta.author == "Feng Huo Xi Zhu Hou"
    assert meta.tags == ["Action", "Xianxia"]
    assert meta.status == "ongoing"
    assert meta.language == "en"
    assert meta.source_chapter_count == 1147
    assert meta.extra["rolia_scan_manga_id"] == 188862
    assert meta.extra["views"] == 5070


def test_list_chapters_uses_signed_api_and_preserves_duplicate_numbers():
    connector = RoliaScanConnector()
    meta = asyncio.run(connector.fetch_novel(FakeFetcher(), connector.PRIORITY_REFS[0]))
    fetcher = FakeFetcher()

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [1.0, 1.01, 2.0]
    assert chapters[1].title == "Chapter 1.2"
    assert chapters[2].published_at is None
    assert len(fetcher.get_json_urls) == 2


def test_normalize_chapter_extracts_reader_text_only():
    connector = RoliaScanConnector()

    norm = connector.normalize_chapter(RawPage(url="https://roliascan.com/read/unsheathed-novel/ch1-1", html=CHAPTER))

    assert norm.title == "Chapter 1"
    assert norm.html == "<p>Chapter 1: Jingzhe</p><p>The story starts here.</p>"
    assert "track" not in norm.html
