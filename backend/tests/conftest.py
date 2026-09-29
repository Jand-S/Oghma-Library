from datetime import datetime, timedelta, timezone

import pytest

from oghma.translation.pricing import PricingSnapshot, save_pricing_snapshots


@pytest.fixture
def fresh_pricing_catalog(tmp_path, monkeypatch):
    path = tmp_path / "pricing-catalog.json"
    monkeypatch.setenv("OGHMA_TRANSLATION_PRICING_INDEX", str(path))
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=1)).isoformat()
    values = {
        "gpt-5.5": (5.0, 0.5, 30.0, "openai"),
        "google/gemini-3-flash-preview": (0.5, 0.05, 3.0, "openrouter"),
        "gpt-5.4-mini": (0.75, 0.075, 4.5, "openai"),
        "gpt-4.1-mini": (0.4, 0.1, 1.6, "openai"),
        "deepseek/deepseek-v4-pro": (0.435, 0.003625, 0.87, "openrouter"),
        "deepseek/deepseek-v4-flash": (0.09, 0.018, 0.18, "openrouter"),
    }
    save_pricing_snapshots(
        [
            PricingSnapshot(
                provider=provider,
                model=model,
                input_usd_per_1m=input_price,
                cached_input_usd_per_1m=cached_price,
                output_usd_per_1m=output_price,
                source_url="test-catalog",
                fetched_at=now.isoformat(),
                expires_at=expires_at,
            )
            for model, (input_price, cached_price, output_price, provider) in values.items()
        ],
        path,
    )
    return path
