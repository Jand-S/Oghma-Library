from datetime import datetime, timezone

from oghma.translation.model_selection import (
    ModelQualityProfile,
    estimate_chapter_tokens,
    recommend_models,
)


def test_estimate_chapter_tokens_uses_real_html_size():
    estimate = estimate_chapter_tokens(["<p>Hello world.</p>", "<p>Second chapter.</p>"])

    assert estimate.chapter_count == 2
    assert estimate.source_chars == 41
    assert estimate.estimated_source_tokens == 10
    assert estimate.estimated_input_tokens == 2410
    assert estimate.estimated_output_tokens == 12


def test_recommend_models_balances_quality_cost_and_latency(fresh_pricing_catalog):
    estimate = estimate_chapter_tokens(["x" * 8000 for _ in range(10)])
    profiles = {
        "deepseek/deepseek-v4-flash": ModelQualityProfile(
            model="deepseek/deepseek-v4-flash",
            quality_score=79.4,
            gate_pass_rate=0.7,
            latency_seconds_per_chapter=98.0,
            experimental=True,
        ),
        "google/gemini-3-flash-preview": ModelQualityProfile(
            model="google/gemini-3-flash-preview",
            quality_score=81.75,
            gate_pass_rate=1.0,
            latency_seconds_per_chapter=21.8,
        ),
    }

    recommendations = recommend_models(
        estimate,
        ["deepseek/deepseek-v4-flash", "google/gemini-3-flash-preview"],
        quality_profiles=profiles,
        mode="balanced",
        usd_brl_rate=5.5,
        price_timestamp=datetime(2026, 7, 2, tzinfo=timezone.utc),
    )

    assert recommendations[0].model == "google/gemini-3-flash-preview"
    assert recommendations[0].estimated_brl is not None
    assert recommendations[0].price_timestamp == "2026-07-02T00:00:00+00:00"
    assert recommendations[1].experimental is True
