"""Testes de parsing do conector House Saikai contra payloads sinteticos."""
import asyncio
import json

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.house_saikai import HouseSaikaiConnector


LISTING = json.dumps({
    "data": [
        {
            "id": 271,
            "title": "A Ameaca do Rei Demonio",
            "slug": "a-ameaca-do-rei-demonio",
            "format_id": 1,
            "image": "series/a-ameaca-do-rei-demonio.webp",
        },
        {
            "id": 999,
            "title": "Comic Ignorado",
            "slug": "comic-ignorado",
            "format_id": 2,
        },
    ],
    "meta": {"current_page": 1, "last_page": 1},
}).encode()

DETAIL = json.dumps({
    "data": {
        "id": 271,
        "title": "A Ameaca do Rei Demonio",
        "slug": "a-ameaca-do-rei-demonio",
        "synopsis": "<p style='color:red'>Uma <strong>jornada</strong>.</p>",
        "image": "series/a-ameaca-do-rei-demonio.webp",
        "format_id": 1,
        "status": {"id": 1, "name": "Concluido"},
        "genres": [{"name": "Fantasia"}, {"name": "Romance"}],
        "tags": [{"name": "Dragao"}],
        "authors": [{"name": "Tiaca Conti"}],
        "separators": [
            {
                "id": 1208,
                "releases": [
                    {
                        "id": 49899,
                        "title": "No Perimetro do Reino Maligno",
                        "chapter": "01",
                        "slug": "capitulo-01",
                        "is_active": 1,
                        "published_at": "2023-04-02T14:48:04.000000Z",
                        "order": 1,
                        "order_all": 1,
                    },
                    {
                        "id": 49974,
                        "title": "A legiao de demonio e monstros",
                        "chapter": "02",
                        "slug": "capitulo-02",
                        "is_active": 1,
                        "order": 2,
                        "order_all": 2,
                    },
                    {
                        "id": 50000,
                        "title": "Desativado",
                        "chapter": "03",
                        "slug": "capitulo-03",
                        "is_active": 0,
                        "order": 3,
                    },
                ],
            }
        ],
    }
}).encode()

RELEASE = json.dumps({
    "data": {
        "id": 49899,
        "title": "No Perimetro do Reino Maligno",
        "release_text": {
            "content": (
                "<div class='reader' style='font-size:16px'>"
                "<p style='text-align:justify'>Primeira <strong>linha</strong>.</p>"
                "<script>tracker()</script>"
                "<p><em>Segunda</em> linha.</p>"
                "</div>"
            )
        },
    }
}).encode()


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=self.pages[url], content_type="application/json")


def test_discover_novels_uses_series_format_and_filters_comics():
    connector = HouseSaikaiConnector()
    fetcher = FakeFetcher({
        connector._listing_url(1): LISTING,
    })

    refs = asyncio.run(connector.discover_novels(fetcher))

    assert [ref.slug for ref in refs] == ["a-ameaca-do-rei-demonio"]
    assert "format=1" in connector._listing_url(1)


def test_fetch_novel_reads_api_metadata():
    connector = HouseSaikaiConnector()
    ref = asyncio.run(connector.discover_novels(FakeFetcher({connector._listing_url(1): LISTING})))[0]
    fetcher = FakeFetcher({connector._detail_url(ref.slug): DETAIL})

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.title == "A Ameaca do Rei Demonio"
    assert meta.cover_url == "https://s3-beta.housesaikai.net/series/a-ameaca-do-rei-demonio.webp"
    assert meta.description == "Uma jornada."
    assert meta.author == "Tiaca Conti"
    assert meta.tags == ["Fantasia", "Romance", "Dragao"]
    assert meta.status == "complete"


def test_list_chapters_reads_separator_releases_and_uses_release_api_urls():
    connector = HouseSaikaiConnector()
    ref = asyncio.run(connector.discover_novels(FakeFetcher({connector._listing_url(1): LISTING})))[0]
    meta = connector._meta_from_story(json.loads(DETAIL.decode())["data"], ref)
    fetcher = FakeFetcher({connector._detail_url(meta.slug): DETAIL})

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [1.0, 2.0]
    assert chapters[0].title == "Capitulo 01 - No Perimetro do Reino Maligno"
    assert chapters[0].url == connector._release_url(49899)
    assert chapters[0].published_at == "2023-04-02T14:48:04.000000Z"


def test_normalize_chapter_extracts_release_text_content():
    connector = HouseSaikaiConnector()

    norm = connector.normalize_chapter(RawPage(url="x", html=RELEASE))

    assert "style=" not in norm.html
    assert "tracker" not in norm.html
    assert norm.html == (
        "<p>Primeira <strong>linha</strong>.</p>"
        "<p><em>Segunda</em> linha.</p>"
    )
    assert len(norm.text_hash) == 64


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print("ok:", fn.__name__)
    print(f"\n{len(fns)} passed")
