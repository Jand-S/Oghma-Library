from oghma.translation.planner import build_translation_plan, build_translation_plan_from_metrics


def test_translation_plan_returns_ranked_recommendations(fresh_pricing_catalog):
    plan = build_translation_plan(
        ["<p>" + ("Foundation Establishment. " * 200) + "</p>"],
        mode="balanced",
        usd_brl_rate=5.5,
    )

    assert plan.chapter_count == 1
    assert plan.estimated_input_tokens > 0
    assert plan.estimated_output_tokens > 0
    assert plan.recommendations
    assert plan.recommendations[0].estimated_brl is not None
    assert all(item.price_timestamp for item in plan.recommendations)


def test_translation_plan_can_limit_models_for_comparison(fresh_pricing_catalog):
    plan = build_translation_plan(
        ["<p>" + ("Gu Master. " * 300) + "</p>"],
        models=["deepseek/deepseek-v4-flash", "google/gemini-3-flash-preview"],
        mode="economy",
    )

    assert {item.model for item in plan.recommendations} == {
        "deepseek/deepseek-v4-flash",
        "google/gemini-3-flash-preview",
    }
    assert any(item.experimental for item in plan.recommendations)


def test_metric_based_plan_scales_cost_with_real_content_size(fresh_pricing_catalog):
    small = build_translation_plan_from_metrics(
        chapter_count=100,
        source_chars=1_000_000,
        models=["gpt-4.1-mini"],
    )
    large = build_translation_plan_from_metrics(
        chapter_count=100,
        source_chars=11_000_000,
        models=["gpt-4.1-mini"],
    )

    assert large.estimated_input_tokens > small.estimated_input_tokens * 7
    assert large.recommendations[0].estimated_usd > small.recommendations[0].estimated_usd * 7
