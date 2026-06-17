"""Testes de parsing do conector contra HTML sintetico (sem rede)."""
from oghma.scraper.connectors.central_novel import CentralNovelConnector
from oghma.scraper.base import RawPage
from oghma.scraper.orchestrator import _cover_extension

LISTING = b"""
<html><body>
  <div class="soralist">
    <a href="https://centralnovel.com/series/86-eighty-six/">86: Eighty Six</a>
  </div>
  <div class="listupd">
    <h2><a href="https://centralnovel.com/series/supreme-magus-20230101/">Supreme Magus</a></h2>
    <h2><a href="https://centralnovel.com/series/shadow-slave-20230928/">Shadow Slave</a></h2>
    <a href="https://centralnovel.com/series/?status=&order=popular">Mais Lidas</a>
  </div>
</body></html>
"""

CHAPTERS = b"""
<html><body>
  <h1 class="entry-title">Supreme Magus</h1>
  <ul class="eplister">
    <li>
      <a href="https://centralnovel.com/supreme-magus-capitulo-1/">
        <div class="epl-num">Vol. 1 Cap. 1</div>
        <div class="epl-title">Comeco</div>
      </a>
      <div class="epl-pdf"><a href="https://centralnovel.com/supreme-magus-capitulo-1/pdf/">PDF</a></div>
    </li>
    <li>
      <a href="https://centralnovel.com/supreme-magus-capitulo-2/">
        <div class="epl-num">Vol. 1 Cap. 2</div>
        <div class="epl-title">Continua</div>
      </a>
    </li>
    <li>
      <a href="https://centralnovel.com/supreme-magus-capitulo-10-5/">
        <div class="epl-num">Vol. 1 Cap. 10.5</div>
        <div class="epl-title">Interludio</div>
      </a>
    </li>
    <li>
      <a href="https://centralnovel.com/a-returners-magic-should-be-special-314/">
        <div class="epl-num">Vol. 8 Cap. 314 [Fim]</div>
        <div class="epl-title">Epilogo</div>
      </a>
    </li>
  </ul>
</body></html>
"""

CONTENT = b"""
<html><body><div class="epcontent">
  <p>Primeira linha.</p><p>Segunda linha de teste.</p>
  <script>tracker()</script>
</div></body></html>
"""

DIRTY_CONTENT = b"""
<html><body>
  <div class="epcontent entry-content" itemprop="text"
       style="font-family:'Fira Sans';font-size:15px;line-height:160%;text-align:justify">
    <p class="has-text-align-justify" style="text-align: justify">Primeira <span style="color:red">linha</span>.</p>
    <div class="adsbygoogle">anuncio</div>
    <blockquote class="wp-block-quote" style="font-size: 18px">
      <p>Uma <b>fala</b> com <i>enfase</i>.</p>
    </blockquote>
    <img class="aligncenter" style="width: 100%" src="https://cdn.test/cena.jpg" alt="Cena" data-id="42">
    <hr class="wp-block-separator">
    <script>tracker()</script>
  </div>
</body></html>
"""


def test_slug_extraction():
    c = CentralNovelConnector()
    assert c.slug_from_url("https://centralnovel.com/series/supreme-magus-20230101/") == "supreme-magus-20230101"


def test_listing_selector_supports_list_mode_and_grid():
    from selectolax.parser import HTMLParser

    c = CentralNovelConnector()
    links = [a.attributes["href"] for a in HTMLParser(LISTING).css(c.LIST_ITEM)]
    assert "https://centralnovel.com/series/86-eighty-six/" in links
    assert "https://centralnovel.com/series/supreme-magus-20230101/" in links


def test_parse_chapters_filters_and_numbers():
    c = CentralNovelConnector()
    chapters = c._parse_chapters(CHAPTERS)
    nums = sorted(ch.number for ch in chapters)
    assert nums == [1.0, 2.0, 10.5, 314.0]
    assert [ch.title for ch in chapters] == ["Comeco", "Continua", "Interludio", "Epilogo"]
    assert all("/pdf/" not in ch.url for ch in chapters)


def test_normalize_strips_scripts():
    c = CentralNovelConnector()
    norm = c.normalize_chapter(RawPage(url="x", html=CONTENT))
    assert "tracker" not in norm.html
    assert norm.word_count >= 4
    assert len(norm.text_hash) == 64


def test_normalize_emits_semantic_html_without_site_wrapper_or_styles():
    c = CentralNovelConnector()
    norm = c.normalize_chapter(RawPage(url="x", html=DIRTY_CONTENT))

    assert "epcontent" not in norm.html
    assert "entry-content" not in norm.html
    assert "font-family" not in norm.html
    assert "style=" not in norm.html
    assert "class=" not in norm.html
    assert "data-id" not in norm.html
    assert "<div" not in norm.html
    assert "<span" not in norm.html
    assert "tracker" not in norm.html
    assert "anuncio" not in norm.html
    assert norm.html == (
        '<p>Primeira linha.</p>'
        '<blockquote><p>Uma <strong>fala</strong> com <em>enfase</em>.</p></blockquote>'
        '<img src="https://cdn.test/cena.jpg" alt="Cena">'
        '<hr>'
    )


def test_cover_extension_detection():
    assert _cover_extension("https://cdn.test/capa.png?resize=370,500", "image/webp", b"x") == "webp"
    assert _cover_extension("https://cdn.test/capa.jpeg?x=1", None, b"x") == "jpg"
    assert _cover_extension("https://cdn.test/capa", None, b"\x89PNG\r\n\x1a\nresto") == "png"
