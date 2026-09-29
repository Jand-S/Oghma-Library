from datetime import datetime, timezone

from oghma.models import TranslationSelectionHistoryRow
from oghma.translation.selection_history import AutomaticSelectionRecord, AutomaticSelectionTrialSummary
from oghma.translation.selection_store import _apply_record_to_row, _record_from_row, merge_selection_records


def _record(record_id: str, created_at: str, winner: str = "gpt-4.1-mini") -> AutomaticSelectionRecord:
    return AutomaticSelectionRecord(
        id=record_id,
        job_id="job",
        novel_id="novel",
        chapter_from=1,
        chapter_to=5,
        target_language="pt-BR",
        mode="balanced",
        winner_model=winner,
        winner_provider="openrouter",
        editorial_grade_count=2,
        editorial_cost_usd=0.01,
        sample_chapters=[1, 3, 5],
        trials=[
            AutomaticSelectionTrialSummary(
                model=winner,
                provider="openrouter",
                average_score=90,
                total_cost_usd=0.02,
                total_duration_seconds=12,
                failure_count=0,
            )
        ],
        created_at=created_at,
    )


def test_selection_history_row_mapping_preserves_trials_and_editorial_data():
    record = _record("record", datetime.now(timezone.utc).isoformat())
    row = TranslationSelectionHistoryRow(id=record.id)

    _apply_record_to_row(row, record)
    restored = _record_from_row(row)

    assert restored.winner_model == "gpt-4.1-mini"
    assert restored.editorial_grade_count == 2
    assert restored.sample_chapters == [1, 3, 5]
    assert restored.trials[0].average_score == 90


def test_merge_selection_records_prefers_newer_duplicate_and_sorts_descending():
    old = _record("same", "2026-01-01T00:00:00+00:00", "gpt-4.1-mini")
    new = _record("same", "2026-01-02T00:00:00+00:00", "google/gemini-3-flash-preview")
    other = _record("other", "2026-01-03T00:00:00+00:00", "gpt-5.4-mini")

    merged = merge_selection_records([old], [new, other])

    assert [item.id for item in merged] == ["other", "same"]
    assert merged[1].winner_model == "google/gemini-3-flash-preview"

