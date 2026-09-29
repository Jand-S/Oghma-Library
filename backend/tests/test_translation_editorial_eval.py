from pathlib import Path

from oghma.translation.editorial_eval import (
    TranslationCandidate,
    candidate_pairs,
    deterministic_metrics,
    pairwise_response_format,
)
from oghma.translation.grade_runner import aggregate_ranking


def _candidate(case_id, model):
    path = Path(f"{case_id}-{model}.html")
    return TranslationCandidate(case_id, model, path, path, path)


def test_deterministic_metrics_detect_residual_english_and_length_ratio():
    metrics = deterministic_metrics(
        "<p>The elder walked into the hall with his disciple.</p>",
        "<p>The elder walked into the hall with his disciple.</p>",
    )

    assert metrics["length_ratio"] == 1.0
    assert metrics["english_marker_count"] >= 4
    assert metrics["residual_source_ngram_count"] > 0


def test_deterministic_metrics_detect_unexpected_writing_system():
    metrics = deterministic_metrics(
        "<p>Several centuries ago.</p>",
        "<p>Há כמה séculos.</p>",
    )

    assert metrics["unexpected_script_count"] == 1


def test_candidate_pairs_only_compare_models_from_same_case():
    pairs = candidate_pairs(
        [
            _candidate("chapter-001", "model-b"),
            _candidate("chapter-001", "model-a"),
            _candidate("chapter-002", "model-a"),
        ]
    )

    assert len(pairs) == 1
    assert [candidate.model for candidate in pairs[0]] == ["model-a", "model-b"]


def test_pairwise_schema_requires_all_editorial_dimensions():
    schema = pairwise_response_format()["schema"]
    score_schema = schema["properties"]["scores_a"]

    assert set(score_schema["required"]) == {
        "fidelity",
        "fluency_ptbr",
        "voice_and_tone",
        "cultural_nuance",
        "terminology",
        "completeness",
    }


def test_aggregate_ranking_counts_blind_wins_and_scores():
    scores_a = {
        "fidelity": 90,
        "fluency_ptbr": 90,
        "voice_and_tone": 90,
        "cultural_nuance": 90,
        "terminology": 90,
        "completeness": 90,
    }
    scores_b = {key: 80 for key in scores_a}
    ranking = aggregate_ranking(
        [
            {
                "status": "succeeded",
                "model_a": "model-a",
                "model_b": "model-b",
                "winner": "model-a",
                "scores": {"model-a": scores_a, "model-b": scores_b},
            }
        ]
    )

    assert ranking[0]["model"] == "model-a"
    assert ranking[0]["wins"] == 1
    assert ranking[0]["mean_editorial_score"] == 90.0
