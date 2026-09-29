"""Testes de parsing do conector Mahou Reader contra HTML sintetico."""
import asyncio
import json

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.mahou_reader import MahouReaderConnector


def next_html(page_props: dict) -> bytes:
    data = {
        "props": {"pageProps": page_props},
        "page": "/test",
        "query": {},
        "buildId": "test",
    }
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return (
        '<html><body><script id="__NEXT_DATA__" type="application/json">'
        + payload
        + "</script></body></html>"
    ).encode("utf-8")


WORKS = next_html({
    "series": [
        {
            "id": 700,
            "slug": "entomologista-do-cla-tang-de-sichuan",
            "title": "Entomologista Do Clã Tang De Sichuan",
            "posterImage": "posterImage.png",
            "mediaType": "NOVEL",
            "status": 2,
            "_count": {"chapters": 419},
        },
        {
            "id": 701,
            "slug": "comic-de-teste",
            "title": "Comic de Teste",
            "posterImage": "posterImage.jpg",
            "mediaType": "COMIC",
            "status": 2,
        },
    ]
})

DETAIL = next_html({
    "serie": {
        "id": 700,
        "slug": "entomologista-do-cla-tang-de-sichuan",
        "title": "Entomologista Do Clã Tang De Sichuan",
        "synopsis": "Uma sinopse boa.",
        "status": 2,
        "adult": False,
        "posterImage": "posterImage.png",
        "releasedAt": "2022",
        "views": 123,
        "mediaType": "NOVEL",
        "subtype": "WEBNOVEL",
        "chaptersCount": 2,
        "titles": [{"title": "Entomologist in Sichuan Tang Clan", "type": "english"}],
        "authors": [{"name": "Erhuhu"}, {"name": "에르훗"}],
        "genres": [
            {"name": "Cotidiano", "text": "Slice of Life"},
            {"name": "Artes Marciais", "text": "Martial arts"},
        ],
        "chapters": [
            {"id": 303347, "volume": 0, "index": 1, "name": None, "createdAt": "2026-06-20T21:00:25.767Z"},
            {"id": 303350, "volume": 0, "index": 2, "name": "Uma visita", "createdAt": "2026-06-20T21:07:55.571Z"},
        ],
    },
    "ratings": {"favorites": 4, "averageRating": "4.5", "monthlyViews": 99, "ratingsCount": 8},
})

CHAPTER = next_html({
    "serie": {"id": 700, "slug": "entomologista-do-cla-tang-de-sichuan"},
    "chapter": {
        "id": 303347,
        "index": 1,
        "name": None,
        "novelChapter": {
            "id": 303347,
            "content": "<p>Primeira linha.</p><script>tracker()</script><p><strong>Segunda</strong> linha.</p>",
        },
    },
    "previousChapter": None,
    "nextChapter": {"id": 303350, "index": 2},
})


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=self.pages[url], content_type="text/html")


def test_discover_novels_reads_next_payload_and_filters_comics():
    connector = MahouReaderConnector()
    fetcher = FakeFetcher({connector._works_url(): WORKS})

    refs = asyncio.run(connector.discover_novels(fetcher))

    assert len(refs) == 1
    assert refs[0].slug == "entomologista-do-cla-tang-de-sichuan"
    assert refs[0].url == "https://mahoureader.com/series/700/entomologista-do-cla-tang-de-sichuan"
    assert connector.expected_total_from_listing(WORKS) == 1


def test_fetch_novel_stores_rating_views_and_source_count_in_extra():
    connector = MahouReaderConnector()
    ref = asyncio.run(connector.discover_novels(FakeFetcher({connector._works_url(): WORKS})))[0]
    fetcher = FakeFetcher({ref.url: DETAIL})

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.title == "Entomologista Do Clã Tang De Sichuan"
    assert meta.cover_url == "https://cdn.mahoureader.com/series/700/posterImage.png"
    assert meta.description == "Uma sinopse boa."
    assert meta.author == "Erhuhu, 에르훗"
    assert meta.tags == ["Cotidiano", "Artes Marciais"]
    assert meta.status == "ongoing"
    assert meta.language == "pt-BR"
    assert meta.source_chapter_count == 2
    assert meta.extra["rating"] == 4.5
    assert meta.extra["ratings_count"] == 8
    assert meta.extra["views"] == 123
    assert meta.extra["monthly_views"] == 99


def test_list_chapters_uses_chapter_ids_for_reader_urls():
    connector = MahouReaderConnector()
    ref = asyncio.run(connector.discover_novels(FakeFetcher({connector._works_url(): WORKS})))[0]
    meta = asyncio.run(connector.fetch_novel(FakeFetcher({ref.url: DETAIL}), ref))

    chapters = asyncio.run(connector.list_chapters(FakeFetcher({meta.url: DETAIL}), meta))

    assert [chapter.number for chapter in chapters] == [1.0, 2.0]
    assert chapters[0].title == "Capitulo 1"
    assert chapters[0].url == "https://mahoureader.com/series/700/ler/303347"
    assert chapters[1].title == "Uma visita"


def test_normalize_chapter_reads_novel_chapter_content():
    connector = MahouReaderConnector()

    norm = connector.normalize_chapter(RawPage(url="https://mahoureader.com/series/700/ler/303347", html=CHAPTER))

    assert norm.html == "<p>Primeira linha.</p><p><strong>Segunda</strong> linha.</p>"
    assert "tracker" not in norm.html
    assert norm.word_count == 4
