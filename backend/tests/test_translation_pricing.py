from datetime import datetime, timedelta, timezone

from oghma.translation.contracts import TokenUsage
from oghma.translation.model_selection import estimate_chapter_tokens, recommend_models
from oghma.translation.pricing import (
    PricingSnapshot,
    estimate_usd,
    load_pricing_snapshots,
    save_pricing_snapshots,
    parse_direct_pricing_html,
)


def test_estimate_usd_uses_fresh_pricing_snapshot(tmp_path, monkeypatch):
    path = tmp_path / "pricing.json"
    monkeypatch.setenv("OGHMA_TRANSLATION_PRICING_INDEX", str(path))
    now = datetime.now(timezone.utc)
    save_pricing_snapshots(
        [
            PricingSnapshot(
                provider="openrouter",
                model="custom/model",
                input_usd_per_1m=1.0,
                cached_input_usd_per_1m=0.5,
                output_usd_per_1m=2.0,
                source_url="test",
                fetched_at=now.isoformat(),
                expires_at=(now + timedelta(hours=1)).isoformat(),
            )
        ],
        path,
    )

    estimate = estimate_usd(
        [
            TokenUsage(
                provider="openrouter",
                model="custom/model",
                operation="translate",
                input_tokens=1_000_000,
                cached_input_tokens=200_000,
                output_tokens=500_000,
            )
        ]
    )

    assert estimate.total == 1.9
    assert load_pricing_snapshots(path)[0].model == "custom/model"


def test_recommend_models_uses_fresh_pricing_snapshot(tmp_path, monkeypatch):
    path = tmp_path / "pricing.json"
    monkeypatch.setenv("OGHMA_TRANSLATION_PRICING_INDEX", str(path))
    now = datetime.now(timezone.utc)
    save_pricing_snapshots(
        [
            PricingSnapshot(
                provider="openrouter",
                model="cheap/model",
                input_usd_per_1m=0.01,
                cached_input_usd_per_1m=0.01,
                output_usd_per_1m=0.01,
                source_url="test",
                fetched_at=now.isoformat(),
                expires_at=(now + timedelta(hours=1)).isoformat(),
            )
        ],
        path,
    )

    recommendations = recommend_models(
        estimate_chapter_tokens(["<p>Hello</p>"]),
        ["cheap/model"],
    )

    assert recommendations[0].model == "cheap/model"
    assert recommendations[0].estimated_usd > 0


def test_parse_openai_official_pricing_table_uses_standard_first_occurrence():
    html = """
    <table><tr><td>gpt-5.4-mini</td><td>$0.75</td><td>$0.075</td><td>$4.50</td></tr></table>
    <table><tr><td>gpt-5.4-mini</td><td>$0.375</td><td>$0.0375</td><td>$2.25</td></tr></table>
    """

    snapshots = parse_direct_pricing_html(
        "openai",
        html,
        fetched_at="2026-07-02T00:00:00+00:00",
        expires_at="2026-07-03T00:00:00+00:00",
    )

    assert len(snapshots) == 1
    assert snapshots[0].input_usd_per_1m == 0.75
    assert snapshots[0].cached_input_usd_per_1m == 0.075
    assert snapshots[0].output_usd_per_1m == 4.5


def test_parse_deepseek_official_pricing_table_maps_cache_hit_and_miss():
    html = """
    <table><tr><td>deepseek-chat</td><td>64K</td><td>8K</td>
    <td>$0.07</td><td>$0.27</td><td>$1.10</td></tr></table>
    """

    snapshots = parse_direct_pricing_html(
        "deepseek",
        html,
        fetched_at="2026-07-02T00:00:00+00:00",
        expires_at="2026-07-03T00:00:00+00:00",
    )

    assert len(snapshots) == 1
    assert snapshots[0].input_usd_per_1m == 0.27
    assert snapshots[0].cached_input_usd_per_1m == 0.07
    assert snapshots[0].output_usd_per_1m == 1.1


def test_parse_gemini_official_pricing_uses_standard_text_prices():
    html = """
    <h2 id="gemini-3-flash-preview">Gemini 3 Flash Preview</h2>
    <em><code>gemini-3-flash-preview</code></em>
    <h3>Standard</h3><table><tbody>
      <tr><td>Input price</td><td>Free</td><td>$0.50 (text)<br>$1.00 (audio)</td></tr>
      <tr><td>Output price (including thinking tokens)</td><td>Free</td><td>$3.00</td></tr>
      <tr><td>Context caching price</td><td>Free</td><td>$0.05 (text)</td></tr>
    </tbody></table>
    """

    snapshots = parse_direct_pricing_html(
        "gemini",
        html,
        fetched_at="2026-07-02T00:00:00+00:00",
        expires_at="2026-07-03T00:00:00+00:00",
    )

    assert len(snapshots) == 1
    assert snapshots[0].model == "gemini-3-flash-preview"
    assert snapshots[0].input_usd_per_1m == 0.5
    assert snapshots[0].cached_input_usd_per_1m == 0.05
    assert snapshots[0].output_usd_per_1m == 3.0


def test_pricing_can_use_fresh_openrouter_alias_for_direct_model(tmp_path):
    path = tmp_path / "pricing.json"
    now = datetime.now(timezone.utc)
    save_pricing_snapshots(
        [
            PricingSnapshot(
                provider="openrouter",
                model="openai/gpt-4.1-mini",
                input_usd_per_1m=0.4,
                cached_input_usd_per_1m=0.1,
                output_usd_per_1m=1.6,
                source_url="test",
                fetched_at=now.isoformat(),
                expires_at=(now + timedelta(hours=1)).isoformat(),
            )
        ],
        path,
    )

    from oghma.translation.pricing import pricing_for_model

    pricing = pricing_for_model("gpt-4.1-mini", path, provider="openai")

    assert pricing is not None
    assert pricing.output_usd_per_1m == 1.6


def test_fresh_alias_wins_over_expired_direct_snapshot(tmp_path):
    path = tmp_path / "pricing.json"
    now = datetime.now(timezone.utc)
    common = {
        "input_usd_per_1m": 0.4,
        "cached_input_usd_per_1m": 0.1,
        "source_url": "test",
        "fetched_at": now.isoformat(),
    }
    save_pricing_snapshots(
        [
            PricingSnapshot(
                provider="openai",
                model="gpt-4.1-mini",
                output_usd_per_1m=99.0,
                expires_at=(now - timedelta(hours=1)).isoformat(),
                **common,
            ),
            PricingSnapshot(
                provider="openrouter",
                model="openai/gpt-4.1-mini",
                output_usd_per_1m=1.6,
                expires_at=(now + timedelta(hours=1)).isoformat(),
                **common,
            ),
        ],
        path,
    )

    from oghma.translation.pricing import pricing_for_model

    pricing = pricing_for_model(
        "gpt-4.1-mini",
        path,
        provider="openai",
        allow_expired=True,
    )

    assert pricing is not None
    assert pricing.output_usd_per_1m == 1.6
