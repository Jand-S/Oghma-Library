"""Contrato do NovelLunar baseado no relatório e nas respostas reais do site."""
import asyncio
import json
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest
from selectolax.parser import HTMLParser

from oghma.scraper.base import NovelRef, RawPage
from oghma.scraper.connectors.novellunar import NovelLunarConnector


FIXTURES = Path(__file__).parent / "fixtures" / "novellunar"
BASE_URL = "https://novellunar.com"
NOVEL_URL = "https://novellunar.com/novel/unsheathed"


def fixture_html(name):
    return HTMLParser((FIXTURES / name).read_bytes())


def plain_text(html):
    return " ".join(HTMLParser(html).text(separator=" ").split())


class FakeFetcher:
    """Somente URLs conhecidas; nenhuma chamada pode chegar à rede.

    Não há capturas das páginas 3–19. O cenário reduzido serve a última
    página capturada como página 3, preservando seus números 951–967.
    """

    def __init__(self, duplicate_number=False):
        self.duplicate_number = duplicate_number
        self.chapter_pages = []

    async def get(self, url: str) -> RawPage:
        parsed = urlparse(url)
        assert parsed.scheme == "https" and parsed.netloc == "novellunar.com"
        query = parse_qs(parsed.query)
        routes = {
            "/": "home.html",
            "/novel/unsheathed": "novel.html",
            "/novel/unsheathed/chapter/1": "chapter-1.html",
            "/novel/unsheathed/chapter/2": "chapter-2.html",
            "/sitemap.xml": "sitemap.xml",
            "/sitemaps/novels/1.xml": "sitemap-novels-1.xml",
            "/sitemaps/novels/2.xml": "sitemap-novels-2.xml",
        }
        if parsed.path == "/new":
            page = int(query.get("page", ["1"])[0])
            assert page in (1, 360), f"Página de catálogo sem fixture: {url}"
            name = "catalog.html" if page == 1 else "catalog-last.html"
        else:
            assert parsed.path in routes, f"URL sem fixture: {url}"
            name = routes[parsed.path]
        return RawPage(
            url=url,
            html=(FIXTURES / name).read_bytes(),
            content_type="application/xml" if name.endswith(".xml") else "text/html",
        )

    async def get_json(self, url: str, params=None):
        parsed = urlparse(url)
        assert parsed.scheme == "https" and parsed.netloc == "novellunar.com"
        assert parsed.path == "/api/novels/chapters"
        query = parse_qs(parsed.query)
        query.update({key: [str(value)] for key, value in (params or {}).items()})
        assert query["novelSlug"] == ["unsheathed"]
        assert query.get("limit", ["50"]) == ["50"]
        assert query["sort"] == ["asc"]
        page = int(query.get("page", ["1"])[0])
        names = {
            1: "chapters.json",
            2: "chapters-page-2.json",
            3: "chapters-last.json",
            4: "chapters-empty.json",
        }
        assert page in names, f"Página de capítulos sem fixture: {url}, {params}"
        self.chapter_pages.append(page)
        payload = json.loads((FIXTURES / names[page]).read_text(encoding="utf-8"))
        payload["pagination"]["page"] = page
        if self.duplicate_number and page == 2:
            # Variação explícita: dois registros com número 51, ainda 50 itens.
            payload["data"][1]["chapterNumber"] = payload["data"][0]["chapterNumber"]
        return payload


def novel_meta(connector):
    ref = NovelRef(source_id="novellunar", slug="unsheathed", url=NOVEL_URL)
    return asyncio.run(connector.fetch_novel(FakeFetcher(), ref))


def test_discover_returns_unique_novel_refs_with_absolute_urls():
    refs = list(asyncio.run(NovelLunarConnector().discover_novels(FakeFetcher(), limit=40)))

    assert len(refs) == 40
    assert len({ref.slug for ref in refs}) == len(refs)
    for ref in refs:
        assert isinstance(ref, NovelRef)
        assert ref.source_id == "novellunar"
        assert ref.slug
        assert ref.url == f"{BASE_URL}/novel/{ref.slug}"
    # O catálogo repete cada link no cartão (capa e título).
    assert any(ref.slug == "hello-devil" for ref in refs)


def test_fetch_novel_extracts_complete_synopsis_and_metadata():
    meta = novel_meta(NovelLunarConnector())
    synopsis = fixture_html("novel.html").css_first("p.whitespace-pre-wrap").text()

    assert meta.title == "Unsheathed"
    assert meta.cover_url == "https://img.novellunar.com/unsheathed.webp"
    assert meta.language == "en"
    assert meta.description and plain_text(meta.description) == " ".join(synopsis.split())
    assert len(plain_text(meta.description).split()) > 20
    assert not HTMLParser(meta.description).css('a[href*="donat"], a[href*="patreon"], a[href*="ko-fi"]')
    for unwanted in ("donate", "donation", "support us", "warning", "rate limit"):
        assert unwanted not in meta.description.lower()


@pytest.mark.parametrize("duplicate_number", [False, True])
def test_list_chapters_paginates_and_preserves_unique_real_numbers(duplicate_number):
    connector = NovelLunarConnector()
    fetcher = FakeFetcher(duplicate_number=duplicate_number)
    chapters = asyncio.run(connector.list_chapters(fetcher, novel_meta(connector)))

    expected = list(range(1, 101)) + list(range(951, 968))
    if duplicate_number:
        expected.remove(52)
    numbers = [chapter.number for chapter in chapters]
    assert chapters
    assert numbers == expected
    assert numbers == sorted(numbers)
    assert len(numbers) == len(set(numbers))
    assert fetcher.chapter_pages[:3] == [1, 2, 3]
    assert fetcher.chapter_pages in ([1, 2, 3], [1, 2, 3, 4])
    for chapter in chapters:
        assert chapter.url == f"{NOVEL_URL}/chapter/{int(chapter.number)}"


@pytest.mark.parametrize("number", [1, 2])
def test_normalize_chapter_keeps_only_complete_story_text(number):
    connector = NovelLunarConnector()
    raw = asyncio.run(connector.fetch_chapter(FakeFetcher(), f"{NOVEL_URL}/chapter/{number}"))
    normalized = connector.normalize_chapter(raw)
    text = plain_text(normalized.html)
    document = fixture_html(f"chapter-{number}.html")
    story = document.css_first('article > div[style*="white-space:pre-wrap"]').text()

    assert len(text.split()) > 20
    assert normalized.word_count > 20
    assert text == " ".join(story.split())
    assert not HTMLParser(normalized.html).css("script, nav, button, select")
    for unwanted in ("loading", "rate limit", "self.__next_f", "download app", "sign in"):
        assert unwanted not in normalized.html.lower()
    assert "Home Latest New Completed Ranking" not in text


def test_ref_from_novel_url_returns_correct_slug():
    ref = NovelLunarConnector().ref_from_url(NOVEL_URL)

    assert isinstance(ref, NovelRef)
    assert ref.source_id == "novellunar"
    assert ref.slug == "unsheathed"
    assert ref.url == "https://novellunar.com/novel/unsheathed"


@pytest.mark.parametrize("suffix", ["/", "?page=2#chapters", "/?page=2#chapters"])
def test_ref_from_url_normalizes_novel_url(suffix):
    ref = NovelLunarConnector().ref_from_url(NOVEL_URL + suffix)

    assert isinstance(ref, NovelRef)
    assert ref.slug == "unsheathed"
    assert ref.url == NOVEL_URL


@pytest.mark.parametrize("url", [
    f"{NOVEL_URL}/chapter/1",
    "https://example.com/novel/unsheathed",
    f"{BASE_URL}/novel/",
])
def test_ref_from_url_rejects_chapter_and_foreign_urls(url):
    assert NovelLunarConnector().ref_from_url(url) is None
