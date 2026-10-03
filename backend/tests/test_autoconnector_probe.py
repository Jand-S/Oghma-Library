"""URL de novel -> NovelRef e o portao probe-connector com um conector falso (sem rede)."""
import asyncio

from oghma.autoconnector.probe import _sample_indexes, probe_connector
from oghma.scraper import registry
from oghma.scraper.base import ChapterRef, NormalizedChapter, NovelMeta, NovelRef, RawPage
from oghma.scraper.novel_url import domain_of, novel_ref_from_url, slug_guess


def test_slug_guess_skips_route_words_and_chapters():
    assert slug_guess("https://site.com/series/super-god-gene/") == "super-god-gene"
    assert slug_guess("https://site.com/novel/foo/capitulo-3") == "foo"
    assert slug_guess("https://site.com/") is None
    assert domain_of("https://www.Site.com/x") == "site.com"


def test_ref_from_url_prefers_connector_method():
    class C:
        id = "x"
        def ref_from_url(self, url):
            return NovelRef("x", "custom", url)
    assert novel_ref_from_url(C(), "https://x.com/book/a").slug == "custom"


def test_sample_indexes_cover_first_and_last():
    assert _sample_indexes(3) == [0, 1, 2]
    picks = _sample_indexes(855)
    assert picks[0] == 0 and picks[-1] == 854 and len(picks) == 5


class FakeConnector:
    id = "fake-site"
    display_name = "Fake"
    base_url = "https://fake.test/"
    capabilities = {"static_html"}
    rate_limit_seconds = 1.0

    def __init__(self, chapters_html):
        self.chapters_html = chapters_html

    async def discover_novels(self, fetcher, limit=None):
        return [NovelRef(self.id, "a", "https://fake.test/novel/a")]

    async def fetch_novel(self, fetcher, ref):
        return NovelMeta(self.id, ref.slug, "Novel A", ref.url, cover_url="https://fake.test/a.jpg",
                         description="<p>" + "Uma historia longa o bastante para passar. " * 3 + "</p>")

    async def list_chapters(self, fetcher, novel):
        return [ChapterRef(float(i), f"Cap {i}", f"https://fake.test/a/{i}") for i in range(1, len(self.chapters_html) + 1)]

    async def fetch_chapter(self, fetcher, url):
        return RawPage(url=url, html=b"")

    def normalize_chapter(self, raw):
        n = int(raw.url.rsplit("/", 1)[1])
        html = self.chapters_html[n - 1]
        return NormalizedChapter("", html, "h", len(html.split()))


class DummyFetcher:
    async def aclose(self):
        pass


def _run(connector):
    registry.register(connector)
    return asyncio.run(probe_connector(connector.id, fetcher=DummyFetcher()))


def test_probe_passes_a_good_connector():
    report = _run(FakeConnector(["<p>texto do capitulo com varias palavras</p>"] * 7))
    assert report.ok, [c for c in report.checks if not c.ok]
    assert report.chapters_listed == 7 and len(report.samples) == 5


def test_probe_rejects_placeholder_chapters():
    html = ["<p>texto bom do capitulo</p>"] * 6 + ["<p>Loading... Loading...</p>"]
    report = _run(FakeConnector(html))
    assert not report.ok
    assert next(c for c in report.checks if c.name == "chapter_content").ok is False
