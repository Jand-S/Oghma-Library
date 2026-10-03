"""Validacao de capitulos, limpeza de sinopse e capitulos faltantes na publicacao."""
import json
import tarfile
from pathlib import Path
from types import SimpleNamespace

import httpx

from oghma.publish.bundles import build_bundle
from oghma.publish.reader import _publishable, missing_chapters
from oghma.publish.records import ChapterRecord, NovelRecord
from oghma.scraper.fetcher import _is_transient
from oghma.scraper.normalize import chapter_problem, clean_description

# Trecho real da pagina de Super God Gene no Central Novel (02/10/2026).
CENTRAL_DESC_HTML = """
<div class="entry-content" itemprop="description"> <div style="text-align: justify;">
<p>Na era interestelar magn&iacute;fica, a humanidade finalmente desenvolveu a tecnologia de teletransporte.</p>
<p><center>『Besouro Preto, Criatura de Linhagem Sagrada foi morta.』</center></p>
<div style="text-align: justify;"> <p>&nbsp;</p> <hr /> <hr />
<h4 style="text-align: center;"><strong>AVISO</strong></h4>
<p>Esta novel foi traduzida pela <a href="https://novelmania.com.br/">Novel Mania</a> e seus colaboradores,
o conteudo e agregado e divulgado pela <a href="https://centralnovel.com/">Central Novel</a> sem autoriza&ccedil;&atilde;o pr&eacute;via dos mesmos.</p>
</div><hr /><p>Se voc&ecirc; possui os direitos legais sobre a obra, entre em <a href="/contato/">contato</a>.</p>
</div></div>
"""

# Como a mesma sinopse esta salva hoje no banco (texto colado, sem <hr>).
CENTRAL_DESC_STORED = (
    "Na era interestelar magnífica, a humanidade finalmente desenvolveu a tecnologia de teletransporte."
    "『Besouro Preto foi morta.』AVISOEsta novel foi traduzida pelaNovel Maniae seus colaboradores, "
    "o conteúdo é agregado e divulgado pelaCentral Novelsem autorização prévia dos mesmos."
)

NOVEL_MANIA_DESC = (
    "<p>Eu, o artista marcial que foi considerado um dos melhores do mundo, agora, estava ca&iacute;do "
    "no asfalto debaixo da chuva...</p>\n<p>Ap&oacute;s algum tempo, a escurid&atilde;o dispersou.</p>"
)


def test_central_description_drops_legal_notice_and_keeps_paragraphs():
    out = clean_description(CENTRAL_DESC_HTML)
    assert out.startswith("Na era interestelar magnífica")
    assert "AVISO" not in out and "autorização" not in out and "contato" not in out
    assert "Besouro Preto" in out
    assert "\n\n" in out  # paragrafos separados


def test_stored_central_description_is_cut_at_notice():
    out = clean_description(CENTRAL_DESC_STORED)
    assert out.endswith("『Besouro Preto foi morta.』")


def test_novel_mania_description_html_becomes_text():
    out = clean_description(NOVEL_MANIA_DESC)
    assert "<p>" not in out and "&iacute;" not in out
    assert "caído no asfalto" in out and "escuridão dispersou" in out
    assert out.count("\n\n") == 1


def test_description_junk_lines_and_prefix_are_removed():
    raw = (
        "Sinopse: Um jovem descobre que pode voltar no tempo e tenta salvar a familia.\n\n"
        "Entre no nosso Discord: discord.gg/abc\n"
        "Apoie a tradução no PIX\n"
        "Tradução: Fulano\n"
        "Leia também nossas outras obras!"
    )
    assert clean_description(raw) == "Um jovem descobre que pode voltar no tempo e tenta salvar a familia."


def test_plain_text_description_keeps_its_line_breaks():
    raw = "《一击魔法师》\n作者: 隐语者\n\"There is no problem that one Fireball cannot solve.\"\n\"If there is, then use two.\""
    assert clean_description(raw) == raw


def test_description_without_text_stays_none():
    assert clean_description(None) is None
    assert clean_description("<p>&nbsp;</p>") is None


def test_chapter_problem_detects_empty_and_placeholders():
    assert chapter_problem("") == "empty"
    assert chapter_problem("<p> </p>") == "empty"
    assert chapter_problem("<p>Loading... Loading...</p>") == "placeholder"
    assert chapter_problem("<p>Rate limit exceeded. Try again later.</p>") == "placeholder"


def test_chapter_problem_accepts_real_and_illustrated_chapters():
    assert chapter_problem('<p></p><img src="../assets/a.webp">') is None
    assert chapter_problem("<p>Fim do volume. Obrigado por ler!</p>") is None
    long_text = "<p>" + " ".join(["palavra"] * 60) + " loading</p>"
    assert chapter_problem(long_text) is None


def _ch(number, *, status="ok", content="/c.html", downloaded=True, problem=None, title=None):
    return SimpleNamespace(number=number, status=status, content_path=content, downloaded=downloaded,
                           problem=problem, title=title or f"Chapter {number:g}")


def test_missing_chapters_lists_invalid_and_integer_gaps_but_not_copies():
    chapters = [
        _ch(3), _ch(4), _ch(4.01, status="duplicate", problem="same_as:4"), _ch(6),
        _ch(7, status="invalid", content=None, downloaded=False, problem="placeholder"),
        _ch(8),
    ]
    missing = missing_chapters(chapters)
    assert [(m["number"], m["reason"]) for m in missing] == [(5.0, "gap"), (7.0, "placeholder")]
    assert [_publishable(c) for c in chapters] == [True, True, False, True, False, True]


def test_copy_in_another_number_counts_as_missing():
    # Solo Leveling no Central Novel: o capitulo 47 do site tem o texto do 46.
    chapters = [_ch(46), _ch(47, status="duplicate", problem="same_as:46"), _ch(48)]
    assert [(m["number"], m["reason"]) for m in missing_chapters(chapters)] == [(47.0, "repeated")]


def test_missing_chapters_ignores_decimal_positions():
    # Novel Mania usa a posicao do site (0.1, 0.2, 1.21) como numero: nao e lacuna.
    chapters = [_ch(0.1), _ch(0.2), _ch(1.21), _ch(3.5)]
    assert missing_chapters(chapters) == []


def test_bundle_skips_empty_files_and_lists_missing(tmp_path: Path):
    novel = NovelRecord(
        id="rolia-scan:unsheathed-novel", source_id="rolia-scan", slug="unsheathed-novel",
        title="Unsheathed", author=None, description=None, cover_path=None, language="en",
        status="ongoing", tags=[], tag_keys=[], updated_at=None,
        chapters=[
            ChapterRecord(id="a#1", number=1.0, title="One", published_at=None, word_count=5,
                          content_path="/1.html", content_hash="h1"),
            ChapterRecord(id="a#2", number=2.0, title="Two", published_at=None, word_count=0,
                          content_path="/2.html", content_hash="h2"),
        ],
        missing=[{"number": 3.0, "title": "Capítulo 3", "reason": "gap"}],
    )
    files = {"/1.html": "<p>um</p>", "/2.html": ""}
    out = tmp_path / "b.tar.gz"
    build_bundle(str(out), novel, version=1, read_content=lambda p: files[p])
    with tarfile.open(out, "r:gz") as tar:
        assert "chapters/2.html" not in tar.getnames()
        meta = json.loads(tar.extractfile("meta.json").read())
    assert [c["number"] for c in meta["chapters"]] == [1.0]
    assert meta["missingChapters"][0]["reason"] == "gap"


def test_only_transient_http_errors_are_retried():
    def status_error(code):
        req = httpx.Request("GET", "https://x.test")
        return httpx.HTTPStatusError("x", request=req, response=httpx.Response(code, request=req))

    assert _is_transient(httpx.ConnectError("down"))
    assert _is_transient(status_error(429)) and _is_transient(status_error(503))
    assert not _is_transient(status_error(404)) and not _is_transient(status_error(403))


def test_transient_errors_are_recorded_with_reason_and_chapter():
    import httpx
    from oghma.scraper.base import ChapterRef
    from oghma.scraper.orchestrator import NOVEL_ERROR_SAMPLES, _is_transient, _record_error

    stats: dict = {}
    timeout = httpx.ReadTimeout("The read operation timed out")
    assert _is_transient(timeout)
    _record_error(stats, "novellunar:unsheathed", ChapterRef(number=468.0, title="Chapter 468", url="u"), timeout)
    assert stats["novel_errors"] == [
        {"novel": "novellunar:unsheathed", "number": 468.0, "error": "ReadTimeout: The read operation timed out"}
    ]
    for _ in range(NOVEL_ERROR_SAMPLES + 5):
        _record_error(stats, "n", None, RuntimeError("x"))
    assert len(stats["novel_errors"]) == NOVEL_ERROR_SAMPLES


def test_rodizio_summary_tells_why_a_novel_stopped():
    from oghma.rodizio import summarize

    level, title, body = summarize("novellunar", {
        "chapters_new": 467, "novels_failed": 1, "novels_done": 0, "novels_total": 1, "chapters_transient": 5,
        "novel_errors": [{"novel": "novellunar:unsheathed", "number": 468.0, "error": "ReadTimeout: timed out"}],
    }, None)
    assert level == "warn"
    assert "capítulo 468" in body and "ReadTimeout" in body and "5 capítulos ficaram para a próxima coleta" in body


def test_catalog_publishes_the_chapter_count_the_site_announces():
    import json
    from oghma.publish.catalog import build_catalog_json
    from oghma.publish.records import NovelRecord, SourceRecord

    novel = NovelRecord(id="novellunar:unsheathed", source_id="novellunar", slug="unsheathed", title="Unsheathed",
                        author=None, description=None, cover_path=None, language="en", status="ongoing", tags=[],
                        tag_keys=[], updated_at=None, extra={"source_chapter_count": 967})
    source = SourceRecord(id="novellunar", name="NovelLunar", base_url="https://novellunar.com/", novel_count=1, last_sync=None)
    payload = json.loads(build_catalog_json(source, [novel], {}))
    assert payload["novels"][0]["sourceChapterCount"] == 967
    assert payload["novels"][0]["chapterCount"] == 0


def test_cold_novels_are_not_marked_missing_file():
    """Capitulos de novel fria ficam so no B2; o audit/mark-chapters nao pode marca-los invalidos."""
    from sqlalchemy.dialects import postgresql
    from oghma.maintenance import short_chapters_query

    sql = str(short_chapters_query("central-novel").compile(dialect=postgresql.dialect()))
    assert "storage_state" in sql and "cold" in str(
        short_chapters_query().compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    assert "source_id" in sql


def test_clean_description_drops_translator_notices_and_separator_lines():
    raw = (
        "⚠️ Atenção!! ⚠️\n\nEssa é a versão WEBNOVEL de Re:Zero disponível originalmente AQUI.\n\n"
        "Subaru é levado a outro mundo e descobre que volta no tempo quando morre.\n\n"
        "==============================\n\n"
        "A qualidade da tradução nos primeiros 80 capítulos é bastante inferior.\n\n"
        "Só ele lembra das mortes, e a atenção dele está em salvar Emilia."
    )
    assert clean_description(raw) == (
        "Subaru é levado a outro mundo e descobre que volta no tempo quando morre.\n\n"
        "Só ele lembra das mortes, e a atenção dele está em salvar Emilia."
    )
