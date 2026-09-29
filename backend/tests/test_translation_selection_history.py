from oghma.translation.selection_history import (
    AutomaticSelectionRecord,
    AutomaticSelectionTrialSummary,
    append_selection_record,
    winning_models_for_novel,
)


def test_winning_models_for_novel_returns_recent_unique_winners(tmp_path):
    path = tmp_path / "selection-history.json"
    base = {
        "job_id": "job",
        "novel_id": "novel",
        "chapter_from": 1,
        "chapter_to": 5,
        "target_language": "pt-BR",
        "mode": "balanced",
        "winner_provider": "openrouter",
        "editorial_grade_count": 2,
        "editorial_cost_usd": 0.01,
        "sample_chapters": [1, 3, 5],
        "trials": [
            AutomaticSelectionTrialSummary(
                model="google/gemini-3-flash-preview",
                provider="openrouter",
                average_score=90,
                total_cost_usd=0.01,
                total_duration_seconds=10,
                failure_count=0,
            )
        ],
    }
    append_selection_record(
        AutomaticSelectionRecord(
            **base,
            id="old",
            winner_model="gpt-4.1-mini",
            created_at="2026-07-01T00:00:00+00:00",
        ),
        path,
    )
    append_selection_record(
        AutomaticSelectionRecord(
            **base,
            id="new",
            winner_model="google/gemini-3-flash-preview",
            created_at="2026-07-02T00:00:00+00:00",
        ),
        path,
    )

    assert winning_models_for_novel("novel", path=path) == [
        "google/gemini-3-flash-preview",
        "gpt-4.1-mini",
    ]
