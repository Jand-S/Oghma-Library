"""Testes de parsing do conector Sky Demon Order contra HTML sintetico."""
import asyncio

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.sky_demon_order import SkyDemonOrderConnector


LISTING_1 = b"""
<html><body>
  <div>145 results</div>
  <a href="https://skydemonorder.com/projects/alpha-novel">Alpha Novel</a>
  <a href="https://skydemonorder.com/projects/beta-novel">Beta Novel</a>
  <a href="https://skydemonorder.com/projects?m=all&pp=48&pg=2">2</a>
</body></html>
"""

LISTING_2 = b"""
<html><body>
  <div>145 results</div>
  <a href="https://skydemonorder.com/projects/gamma-novel">Gamma Novel</a>
</body></html>
"""

NOVEL = b"""
<html><head>
  <meta name="description" content="A public synopsis.">
  <meta property="og:image" content="https://cdn.test/cover.webp">
</head><body><main>
  <span class="text-tag-ongoing">Ongoing</span>
  <span>Korean</span>
  <h1>Alpha Novel</h1>
  <div x-ref="desc"><p>A better synopsis.</p></div>
  <a href="https://skydemonorder.com/projects?g=7">Fantasy</a>
  <a href="https://skydemonorder.com/projects?t=46">Male Protagonist</a>
  <a href="https://skydemonorder.com/projects/alpha-novel/1-first-step">Start Reading</a>
</main></body></html>
"""

MATURE_NOVEL = b"""
<html><head>
  <meta property="og:image" content="https://skydemonorder.com/images/mature-placeholder.png">
</head><body><main>
  <span class="text-tag-ongoing">Ongoing</span>
  <h1>Into The R-Rated World</h1>
  <img :src="!matureToggle ? '/images/mature-placeholder.svg' : 'https://skydemonorder.nyc3.cdn.digitaloceanspaces.com/covers/HAxVLm0oMLTmyr64kcnz3T4IpB7VjrZsRyqyQDSi.png'">
</main></body></html>
"""

CHAPTER_1 = b"""
<html><head>
  <script type="application/ld+json">{"datePublished":"2026-06-01T00:00:00+00:00"}</script>
</head><body>
  <h1>1 &mdash; First Step</h1>
  <div id="chapter-body">
    <p>First <strong>line</strong>.</p>
    <script>tracker()</script>
    <p>Second line.</p>
  </div>
  <a href="https://skydemonorder.com/projects/alpha-novel/2-second-step">NEXT</a>
</body></html>
"""

CHAPTER_2 = b"""
<html><body>
  <h1>2 &mdash; Second Step</h1>
  <div id="chapter-body"><p>Another chapter.</p></div>
  <a href="https://skydemonorder.com/projects/alpha-novel/3-premium-step">NEXT</a>
</body></html>
"""

PAYWALL = b"""
<html><body>
  <h1>Premium Chapter</h1>
  <button>Unlock</button>
</body></html>
"""


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=self.pages[url], content_type="text/html")


def test_discover_novels_paginates_projects_listing():
    connector = SkyDemonOrderConnector()
    fetcher = FakeFetcher({
        connector._listing_url(1): LISTING_1,
        connector._listing_url(2): LISTING_2,
    })

    refs = asyncio.run(connector.discover_novels(fetcher))

    assert [ref.slug for ref in refs] == ["alpha-novel", "beta-novel", "gamma-novel"]
    assert connector.expected_total_from_listing(LISTING_1) == 145


def test_fetch_novel_uses_english_content_language():
    connector = SkyDemonOrderConnector()
    ref = asyncio.run(connector.discover_novels(FakeFetcher({connector._listing_url(1): LISTING_1}), limit=1))[0]
    fetcher = FakeFetcher({ref.url: NOVEL})

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.title == "Alpha Novel"
    assert meta.cover_url == "https://cdn.test/cover.webp"
    assert meta.description == "A better synopsis."
    assert meta.tags == ["Fantasy", "Male Protagonist"]
    assert meta.status == "ongoing"
    assert meta.language == "en"


def test_fetch_novel_prefers_real_mature_cover_over_placeholder():
    connector = SkyDemonOrderConnector()
    ref = connector._parse_project_refs(b'<a href="https://skydemonorder.com/projects/into-the-r-rated-world">x</a>')[0]
    fetcher = FakeFetcher({ref.url: MATURE_NOVEL})

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.cover_url == (
        "https://skydemonorder.nyc3.cdn.digitaloceanspaces.com/covers/"
        "HAxVLm0oMLTmyr64kcnz3T4IpB7VjrZsRyqyQDSi.png"
    )


def test_list_chapters_walks_free_next_links_and_stops_at_paywall():
    connector = SkyDemonOrderConnector()
    meta = asyncio.run(connector.fetch_novel(
        FakeFetcher({"https://skydemonorder.com/projects/alpha-novel": NOVEL}),
        connector._parse_project_refs(LISTING_1)[0],
    ))
    fetcher = FakeFetcher({
        meta.url: NOVEL,
        "https://skydemonorder.com/projects/alpha-novel/1-first-step": CHAPTER_1,
        "https://skydemonorder.com/projects/alpha-novel/2-second-step": CHAPTER_2,
        "https://skydemonorder.com/projects/alpha-novel/3-premium-step": PAYWALL,
    })

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [1.0, 2.0]
    assert chapters[0].title == "1 \u2014 First Step"
    assert chapters[0].published_at == "2026-06-01T00:00:00+00:00"


def test_normalize_chapter_extracts_chapter_body():
    connector = SkyDemonOrderConnector()

    norm = connector.normalize_chapter(RawPage(url="x", html=CHAPTER_1))

    assert "tracker" not in norm.html
    assert "id=" not in norm.html
    assert norm.html == "<p>First <strong>line</strong>.</p><p>Second line.</p>"
    assert len(norm.text_hash) == 64
