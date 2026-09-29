from datetime import datetime, timezone

from oghma.models import TranslationMemoryTermRow
from oghma.translation.memory import TranslationMemoryTerm
from oghma.translation.memory_store import _apply_term_to_row, _term_from_row, merge_memory_terms


def test_translation_memory_term_row_mapping_preserves_term_metadata():
    term = TranslationMemoryTerm(
        novel_id="novel",
        source="Gu Master",
        target="Mestre Gu",
        status="locked",
        category="rank_title",
        occurrences=7,
        first_chapter=1,
        last_chapter=9,
        confidence=0.98,
        notes="manual",
        updated_at=datetime.now(timezone.utc).isoformat(),
    )
    row = TranslationMemoryTermRow(id="novel:gu master")

    _apply_term_to_row(row, term)
    restored = _term_from_row(row)

    assert restored.novel_id == "novel"
    assert restored.source == "Gu Master"
    assert restored.target == "Mestre Gu"
    assert restored.status == "locked"
    assert restored.occurrences == 7
    assert restored.first_chapter == 1
    assert restored.last_chapter == 9


def test_merge_memory_terms_prefers_locked_target_and_sums_occurrences():
    auto = TranslationMemoryTerm(
        "novel",
        "Gu Master",
        "Mestre Gu",
        status="locked_auto",
        occurrences=3,
        confidence=0.8,
    )
    manual = TranslationMemoryTerm(
        "novel",
        "gu master",
        "Cultivador Gu",
        status="locked",
        occurrences=0,
        confidence=1.0,
    )

    merged = merge_memory_terms([auto], [manual])

    assert len(merged) == 1
    assert merged[0].target == "Cultivador Gu"
    assert merged[0].status == "locked"
    assert merged[0].occurrences == 3

