"""Testes de parsing do conector Novel Mania contra HTML sintetico."""
import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from oghma.scraper.base import RawPage
from oghma.scraper.connectors.novel_mania import NovelManiaConnector


LISTING = b"""
<html><body>
  <main>
    <p>426 novels encontradas</p>
    <a href="/novels/86-oitenta-e-seis">Light Novel 86: Eighty Six</a>
    <a href="https://novelmania.com.br/novels/a-ascensao-do-heroi-do-escudo">
      Webnovel A Ascensao do Heroi do Escudo
    </a>
    <a href="/novels">Catalogo</a>
    <script>
      window.__payload = {"href":"/novels/ponto-de-vista-do-leitor-onisciente"};
    </script>
  </main>
</body></html>
"""

NOVEL = b"""
<html>
  <head>
    <title>Novel 86: Eighty Six - Novel Mania</title>
    <meta property="og:image" content="https://cdn.novelmania.test/covers/86.webp">
    <meta name="description" content="A Republica de San Magnolia diz viver em paz.">
    <meta name="author" content="Asato Asato">
  </head>
  <body>
    <main>
      <h1>86: Eighty Six</h1>
      <a href="/genres/drama">Drama</a>
      <a href="/genres/sci-fi">Sci-Fi</a>
      <span class="status">Em andamento</span>
    </main>
  </body>
</html>
"""

CHAPTERS = b"""
<html><body>
  <main>
    <a href="/novels/86-oitenta-e-seis/chapters/capitulo-1">Capitulo 1 - Zona 86</a>
    <a href="/novels/86-oitenta-e-seis/chapters/capitulo-2">Capitulo 2</a>
    <a href="/novels/86-oitenta-e-seis/chapters/10-5">Interludio</a>
    <a href="/novels/86-oitenta-e-seis/reviews">Avaliacoes</a>
    <a href="/novels/outra-obra/chapters/capitulo-1">Outro livro</a>
  </main>
</body></html>
"""

CONTENT = b"""
<html><body>
  <main>
    <article class="chapter-content" style="font-size: 16px">
      <p>Primeira <strong>linha</strong>.</p>
      <p><em>Segunda</em> linha.</p>
      <script>tracker()</script>
    </article>
  </main>
</body></html>
"""

SERIALIZED_CONTENT = br'''
<html><body>
  <script class="$tsr">
    self.$_TSR={};
    $R[17]={content:"\x3Cp style=\"text-align: center;\"\x3E\x3Cstrong\x3EIntro\x3C/strong\x3E\x3C/p\x3E\r\n\x3Cp\x3ETexto \x3Cem\x3Elimpo\x3C/em\x3E.\x3C/p\x3E"};
  </script>
</body></html>
'''

API_LISTING = json.dumps({
    "success": True,
    "data": [
        {"slug": "86-oitenta-e-seis", "title": "86: Eighty Six"},
        {"slug": "a-ascensao-do-heroi-do-escudo", "title": "A Ascensao do Heroi do Escudo"},
    ],
    "meta": {"page": 1, "pages": 1},
}).encode()

API_NOVEL = json.dumps({
    "success": True,
    "data": {
        "title": "86: Eighty Six",
        "slug": "86-oitenta-e-seis",
        "status": "Pausado",
        "author": "Asato Asato",
        "synopsis": "A Republica de San Magnolia diz viver em paz.",
        "kind": "Light Novel",
        "nationality": "Japonesa",
        "category": {"name": "Militar"},
        "categories": [{"name": "Drama"}, {"name": "Sci-Fi"}],
        "cover": {"original": "https://assets.novelmania.test/capa.jpg"},
    },
}).encode()

API_CHAPTERS = json.dumps({
    "success": True,
    "data": [
        {
            "position": 0,
            "title": "Prologo",
            "longTitle": "Volume 1 - Prologo",
            "slug": "volume-1-prologo",
            "publishedAt": "2020-08-10T20:06:40.853-03:00",
        },
        {
            "position": 1,
            "title": "Capitulo 1",
            "slug": "volume-1-capitulo-1",
        },
    ],
    "meta": {"page": 1, "pages": 1},
}).encode()


class FakeFetcher:
    def __init__(self, pages: dict[str, bytes]) -> None:
        self.pages = pages

    async def get(self, url: str) -> RawPage:
        return RawPage(url=url, html=self.pages[url])


def test_listing_parses_anchor_and_hydrated_links():
    connector = NovelManiaConnector()
    refs = connector._parse_novel_refs(LISTING)

    assert [ref.slug for ref in refs] == [
        "86-oitenta-e-seis",
        "a-ascensao-do-heroi-do-escudo",
        "ponto-de-vista-do-leitor-onisciente",
    ]
    assert connector.expected_total_from_listing(LISTING) == 426


def test_discover_novels_respects_limit():
    connector = NovelManiaConnector()
    fetcher = FakeFetcher({"https://novelmania.com.br/api/novels?page=1&items=100": API_LISTING})

    refs = asyncio.run(connector.discover_novels(fetcher, limit=2))

    assert [ref.slug for ref in refs] == [
        "86-oitenta-e-seis",
        "a-ascensao-do-heroi-do-escudo",
    ]


def test_fetch_novel_reads_api_metadata_and_tags():
    connector = NovelManiaConnector()
    ref = connector._parse_novel_refs(LISTING)[0]
    fetcher = FakeFetcher({"https://novelmania.com.br/api/novels/86-oitenta-e-seis": API_NOVEL})

    meta = asyncio.run(connector.fetch_novel(fetcher, ref))

    assert meta.title == "86: Eighty Six"
    assert meta.cover_url == "https://assets.novelmania.test/capa.jpg"
    assert meta.description == "A Republica de San Magnolia diz viver em paz."
    assert meta.author == "Asato Asato"
    assert meta.tags == ["Militar", "Light Novel", "Japonesa", "Drama", "Sci-Fi"]
    assert meta.status == "paused"


def test_list_chapters_uses_api_and_public_chapter_urls():
    connector = NovelManiaConnector()
    meta = connector._meta_from_api_novel(json.loads(API_NOVEL.decode())["data"], connector._parse_novel_refs(LISTING)[0])
    fetcher = FakeFetcher({
        "https://novelmania.com.br/api/novels/86-oitenta-e-seis/chapters?page=1&items=100&sort=asc": API_CHAPTERS,
    })

    chapters = asyncio.run(connector.list_chapters(fetcher, meta))

    assert [chapter.number for chapter in chapters] == [0.0, 1.0]
    assert chapters[0].title == "Volume 1 - Prologo"
    assert chapters[0].url == "https://novelmania.com.br/novels/86-oitenta-e-seis/capitulos/volume-1-prologo"


def test_parse_chapters_filters_by_novel_and_orders_numbers():
    connector = NovelManiaConnector()
    chapters = connector._parse_chapters(
        CHAPTERS,
        "86-oitenta-e-seis",
        "https://novelmania.com.br/novels/86-oitenta-e-seis",
    )

    assert [chapter.number for chapter in chapters] == [1.0, 2.0, 10.5]
    assert chapters[0].title == "Capitulo 1 - Zona 86"
    assert all("outra-obra" not in chapter.url for chapter in chapters)


def test_normalize_chapter_uses_semantic_html_allowlist():
    connector = NovelManiaConnector()
    norm = connector.normalize_chapter(RawPage(url="x", html=CONTENT))

    assert "chapter-content" not in norm.html
    assert "style=" not in norm.html
    assert "tracker" not in norm.html
    assert norm.html == (
        "<p>Primeira <strong>linha</strong>.</p>"
        "<p><em>Segunda</em> linha.</p>"
    )
    assert len(norm.text_hash) == 64


def test_normalize_chapter_extracts_tanstack_serialized_content():
    connector = NovelManiaConnector()
    norm = connector.normalize_chapter(RawPage(url="x", html=SERIALIZED_CONTENT))

    assert "style=" not in norm.html
    assert norm.html == "<p><strong>Intro</strong></p><p>Texto <em>limpo</em>.</p>"
    assert norm.word_count >= 2


def test_normalize_rejects_rate_limit_even_with_http_200_page():
    raw = RawPage(url="chapter", html=b'<main></main><script>{message:"Rate limit exceeded. Try again later."}</script>')
    with pytest.raises(ValueError, match="rate limit"):
        NovelManiaConnector().normalize_chapter(raw)


def test_normalize_rejects_empty_but_preserves_illustrated_chapter():
    connector = NovelManiaConnector()
    with pytest.raises(ValueError, match="empty chapter"):
        connector.normalize_chapter(RawPage(url="chapter", html=b"<main><p> </p></main>"))
    result = connector.normalize_chapter(RawPage(url="chapter", html=b'<article><img src="image.jpg"></article>'))
    assert 'src="image.jpg"' in result.html


def test_fetch_chapter_retries_soft_rate_limit():
    fetcher = FakeFetcher({})
    fetcher.get = AsyncMock(side_effect=[
        RawPage(url="chapter", html=b'<main></main><script>Rate limit exceeded</script>'),
        RawPage(url="chapter", html=CONTENT),
    ])
    with patch("oghma.scraper.connectors.novel_mania.asyncio.sleep", new_callable=AsyncMock) as sleep:
        result = asyncio.run(NovelManiaConnector().fetch_chapter(fetcher, "chapter"))
    assert result.html == CONTENT
    assert fetcher.get.await_count == 2
    sleep.assert_awaited_once_with(15)


def test_fetch_chapter_fails_after_bounded_empty_retries():
    fetcher = FakeFetcher({"chapter": b"<main></main>"})
    with patch("oghma.scraper.connectors.novel_mania.asyncio.sleep", new_callable=AsyncMock) as sleep:
        with pytest.raises(ValueError, match="empty chapter"):
            asyncio.run(NovelManiaConnector().fetch_chapter(fetcher, "chapter"))
    assert sleep.await_count == 3


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print("ok:", fn.__name__)
    print(f"\n{len(fns)} passed")
