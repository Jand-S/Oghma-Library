import pytest

from oghma.translation import (
    GlossaryTerm,
    TranslationContext,
    TranslationPipeline,
    TranslatedSegment,
    render_translated_html,
    segment_html,
)
from oghma.translation.providers import FakeTranslationProvider


def test_segment_html_emits_stable_semantic_blocks():
    html = (
        "<p>He reached <strong>Foundation Establishment</strong>.</p>"
        "<blockquote><p>A sect elder spoke.</p></blockquote>"
        '<img src="../assets/scene.png" alt="Scene">'
        "<hr>"
    )

    segments = segment_html(html)

    assert [segment.key for segment in segments] == [
        "p0001",
        "blockquote0001",
        "img0001",
        "hr0001",
    ]
    assert segments[0].source_text == "He reached Foundation Establishment."
    assert segments[1].source_html == "<blockquote><p>A sect elder spoke.</p></blockquote>"
    assert segments[2].source_text == ""
    assert len(segments[0].source_hash) == 64


@pytest.mark.asyncio
async def test_pipeline_uses_locked_glossary_and_auto_approves():
    pipeline = TranslationPipeline(FakeTranslationProvider())
    context = TranslationContext(
        glossary_terms=[
            GlossaryTerm(
                source="Foundation Establishment",
                target="Estabelecimento de Fundacao",
                status="locked",
            )
        ]
    )

    result = await pipeline.translate_html("<p>Foundation Establishment was only the beginning.</p>", context)

    assert result.status == "approved_auto"
    assert result.issues == []
    assert "Estabelecimento de Fundacao" in result.translated_html


@pytest.mark.asyncio
async def test_pipeline_repairs_glossary_mismatch_before_approval():
    pipeline = TranslationPipeline(
        FakeTranslationProvider(apply_glossary_on_translate=False)
    )
    context = TranslationContext(
        max_repair_attempts=1,
        glossary_terms=[
            GlossaryTerm(
                source="Foundation Establishment",
                target="Estabelecimento de Fundacao",
                status="locked",
            )
        ],
    )

    result = await pipeline.translate_html("<p>Foundation Establishment was only the beginning.</p>", context)

    assert result.status == "approved_auto"
    assert result.repair_attempts == 1
    assert result.issues == []
    assert "Estabelecimento de Fundacao" in result.translated_html


@pytest.mark.asyncio
async def test_pipeline_keeps_unattended_draft_when_quality_issue_persists():
    pipeline = TranslationPipeline(
        FakeTranslationProvider(apply_glossary_on_translate=False)
    )
    context = TranslationContext(
        max_repair_attempts=0,
        glossary_terms=[
            GlossaryTerm(
                source="Foundation Establishment",
                target="Estabelecimento de Fundacao",
                status="locked",
            )
        ],
    )

    result = await pipeline.translate_html("<p>Foundation Establishment was only the beginning.</p>", context)

    assert result.status == "draft_with_warnings"
    assert result.repair_attempts == 0
    assert [issue.issue_type for issue in result.issues] == ["glossary_mismatch"]
    assert result.translated_html


class DroppingProvider(FakeTranslationProvider):
    async def translate_segments(self, segments, context):
        translated = await super().translate_segments(segments, context)
        return translated[:-1]


@pytest.mark.asyncio
async def test_pipeline_fails_when_provider_loses_segments():
    pipeline = TranslationPipeline(DroppingProvider())
    context = TranslationContext(max_repair_attempts=0)

    result = await pipeline.translate_html("<p>First.</p><p>Second.</p>", context)

    assert result.status == "failed"
    assert result.translated_html == ""
    assert [issue.issue_type for issue in result.issues] == ["missing_segment"]


def test_render_translated_html_preserves_source_order():
    source = segment_html("<p>First.</p><p>Second.</p>")
    translated = [
        TranslatedSegment(key="p0002", translated_html="<p>Segundo.</p>"),
        TranslatedSegment(key="p0001", translated_html="<p>Primeiro.</p>"),
    ]

    assert render_translated_html(source, translated) == "<p>Primeiro.</p><p>Segundo.</p>"


@pytest.mark.asyncio
async def test_pipeline_rejects_unexpected_writing_system_as_auto_approved():
    class ContaminatingProvider(FakeTranslationProvider):
        async def translate_segments(self, segments, context):
            translated = await super().translate_segments(segments, context)
            return [
                TranslatedSegment(item.key, item.translated_html.replace("séculos", "כמה séculos"))
                for item in translated
            ]

    pipeline = TranslationPipeline(ContaminatingProvider(prefix=""))
    result = await pipeline.translate_html("<p>Há séculos, ele partiu.</p>", TranslationContext(max_repair_attempts=0))

    assert result.status == "draft_with_warnings"
    assert [issue.issue_type for issue in result.issues] == ["unexpected_script"]


@pytest.mark.asyncio
async def test_pipeline_rejects_mojibake_as_auto_approved():
    class MojibakeProvider(FakeTranslationProvider):
        async def translate_segments(self, segments, context):
            return [TranslatedSegment(item.key, "<p>VocÃª abriu sua abertura.</p>") for item in segments]

    pipeline = TranslationPipeline(MojibakeProvider(prefix=""))
    result = await pipeline.translate_html("<p>You opened your aperture.</p>", TranslationContext(max_repair_attempts=0))

    assert result.status == "draft_with_warnings"
    assert [issue.issue_type for issue in result.issues] == ["mojibake"]


@pytest.mark.asyncio
async def test_pipeline_warns_without_repairing_truncated_source():
    source = (
        '<p>He turned toward the visitor and said, "I crossed the entire valley '
        'because I needed to tell you something important</p>'
    )
    pipeline = TranslationPipeline(FakeTranslationProvider(prefix=""))

    result = await pipeline.translate_html(source, TranslationContext(max_repair_attempts=2))

    assert result.status == "draft_with_warnings"
    assert result.repair_attempts == 0
    assert {issue.issue_type for issue in result.issues} == {
        "source_unbalanced_quotes",
        "source_truncated_sentence",
    }
