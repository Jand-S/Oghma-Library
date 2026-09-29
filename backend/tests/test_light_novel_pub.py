"""Testes de parsing do conector Light Novel Pub."""
import asyncio

import pytest

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.light_novel_pub import LightNovelPubConnector


LIST_PAGE = b"""
<html><body>
  <div class="ul-list1">
    <h3 class="tit"><a href="https://lightnovelpub.me/book/alpha">Alpha Novel</a></h3>
    <a href="https://lightnovelpub.me/book/alpha/chapter-1">Chapter</a>
    <h3 class="tit"><a href="/book/beta">Beta Novel</a></h3>
  </div>
  <ul class="pagination">
    <li class="last"><a href="https://lightnovelpub.me/list/latest-novels/1">Last</a></li>
  </ul>
</body></html>
"""

NOVEL_PAGE = b"""
<html><head>
  <meta property="og:image" content="https://media.lightnovelpub.me/novel/unsheathed.jpg">
  <meta property="og:novel:genre" content="ACTION,ADVENTURE,MARTIAL ARTS">
  <meta property="og:novel:author" content="Fenghuo">
  <meta property="og:novel:novel_name" content="Unsheathed">
  <meta property="og:novel:status" content="OnGoing">
  <meta property="og:novel:read_url" content="https://lightnovelpub.me/book/unsheathed/chapter-1-jingzhe">
  <meta property="og:novel:update_time" content="2026-06-22T23:30:04.778Z">
  <meta property="og:novel:lastest_chapter_name" content="Chapter 603 (1): My Master is the One Fighting">
</head><body>
  <div class="m-desc">
    <h1 class="tit">Unsheathed</h1>
    <div class="score"><p class="vote">4.1 / 5 ( 119 votes )</p></div>
    <div class="txt"><div class="inner">A swordsman walks south.</div></div>
  </div>
  <div class="m-newest2">
    <ul class="ul-list5">
      <li><a class="con" href="https://lightnovelpub.me/book/unsheathed/chapter-1-jingzhe" title="Chapter 1: Jingzhe">Chapter 1</a></li>
      <li><a class="con" href="https://lightnovelpub.me/book/unsheathed/chapter-2-open-the-door" title="Chapter 2: Open the Door">Chapter 2</a></li>
    </ul>
    <div class="page">
      <select id="indexselect" novel-id="unsheathed">
        <option value="1">C.1 - C.40</option>
        <option value="2">C.41 - C.80</option>
      </select>
    </div>
  </div>
</body></html>
"""

NOVEL_PAGE_2 = b"""
<html><body>
  <div class="m-newest2">
    <ul class="ul-list5">
      <li><a class="con" href="https://lightnovelpub.me/book/unsheathed/chapter-603-1-my-master" title="Chapter 603 (1): My Master">Chapter 603 (1)</a></li>
    </ul>
  </div>
</body></html>
"""

CATALOG = b"""
{
  "success": true,
  "chapters": [
    {"chapter_name": "Chapter 1: Jingzhe", "chapter_id": "chapter-1-jingzhe"},
    {"chapter_name": "Chapter 2: Open the Door", "chapter_id": "chapter-2-open-the-door"},
    {"chapter_name": "Chapter 603 (1): My Master", "chapter_id": "chapter-603-1-my-master"}
  ]
}
"""

CHAPTER = b"""
<html><body>
  <article class="chapter-content">
    <h1>Chapter 1: Jingzhe</h1>
    <p>The first paragraph.</p>
    <script>tracker()</script>
    <p><strong>The second</strong> paragraph.</p>
  </article>
</body></html>
"""


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages
        self.calls: list[str] = []

    async def get(self, url: str) -> RawPage:
        self.calls.append(url)
        return RawPage(url=url, html=self.pages[url], content_type="text/html")


def test_discover_prioritizes_unsheathed_and_deduplicates_lists():
    connector = LightNovelPubConnector()
    pages = {
        connector._list_url(path): LIST_PAGE
        for path in connector.LIST_PATHS
    }

    refs = asyncio.run(connector.discover_novels(FakeFetcher(pages), limit=3))

    assert [ref.slug for ref in refs] == ["unsheathed", "alpha", "beta"]


def test_fetch_novel_parses_metadata_rating_and_english_language():
    connector = LightNovelPubConnector()
    ref = connector.PRIORITY_REFS[0]
    meta = asyncio.run(connector.fetch_novel(FakeFetcher({ref.url: NOVEL_PAGE}), ref))

    assert meta.title == "Unsheathed"
    assert meta.cover_url == "https://media.lightnovelpub.me/novel/unsheathed.jpg"
    assert meta.author == "Fenghuo"
    assert meta.tags == ["Action", "Adventure", "Martial Arts"]
    assert meta.status == "ongoing"
    assert meta.language == "en"
    assert meta.source_chapter_count == 603
    assert meta.extra["rating"] == 4.1
    assert meta.extra["rating_votes"] == 119


def test_list_chapters_walks_index_pages_and_keeps_split_chapter_number():
    connector = LightNovelPubConnector()
    ref = connector.PRIORITY_REFS[0]
    fetcher = FakeFetcher({
        ref.url: NOVEL_PAGE,
        connector._chapter_catalog_url("unsheathed", "chapter-1-jingzhe"): CATALOG,
    })
    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [1.0, 2.0, 603.1]
    assert chapters[-1].title == "Chapter 603 (1): My Master"


def test_normalize_chapter_extracts_content_and_rejects_cloudflare_challenge():
    connector = LightNovelPubConnector()

    norm = connector.normalize_chapter(RawPage(url="x", html=CHAPTER))

    assert "tracker" not in norm.html
    assert "<p>The first paragraph.</p>" in norm.html
    assert "<p><strong>The second</strong> paragraph.</p>" in norm.html

    with pytest.raises(ValueError, match="Cloudflare challenge"):
        connector.normalize_chapter(RawPage(url="x", html=b"<span id='challenge-error-text'>Enable JavaScript</span>"))
