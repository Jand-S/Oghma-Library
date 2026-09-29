from datetime import datetime, timezone

from oghma.models import TranslationChapterRow
from oghma.translation.coverage import TranslationChapterRecord
from oghma.translation.coverage_store import _apply_record_to_row, _record_from_row, merge_coverage_records


def test_translation_chapter_row_mapping_preserves_reuse_metadata():
    record = TranslationChapterRecord(
        novel_id="novel",
        chapter_id="novel#1",
        chapter_number=1,
        target_language="pt-BR",
        status="approved_auto",
        translated_path="chapter-1.html",
        sidecar_path="chapter-1.html.json",
        source_hash="source",
        translated_hash="translated",
        model="gpt-4.1-mini",
        provider="openai",
        quality_score=91.5,
        public_reusable=True,
        origin="job",
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    row = TranslationChapterRow(id="novel:pt-BR:1")

    _apply_record_to_row(row, record)
    restored = _record_from_row(row)

    assert restored.novel_id == "novel"
    assert restored.chapter_number == 1
    assert restored.translated_path == "chapter-1.html"
    assert restored.model == "gpt-4.1-mini"
    assert restored.quality_score == 91.5
    assert restored.is_reusable


def test_merge_coverage_records_prefers_newer_record():
    old = TranslationChapterRecord(
        "novel",
        1,
        target_language="pt-BR",
        source_hash="old",
        updated_at="2026-01-01T00:00:00+00:00",
    )
    new = TranslationChapterRecord(
        "novel",
        1,
        target_language="pt-BR",
        source_hash="new",
        updated_at="2026-01-02T00:00:00+00:00",
    )

    merged = merge_coverage_records([old], [new])

    assert len(merged) == 1
    assert merged[0].source_hash == "new"

