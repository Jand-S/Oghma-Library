"""Token cost estimation for translation runs."""
from __future__ import annotations

import os
from dataclasses import dataclass

from .contracts import CostEstimate, TokenUsage


@dataclass(frozen=True)
class ModelPricing:
    input_usd_per_1m: float
    cached_input_usd_per_1m: float
    output_usd_per_1m: float


DEFAULT_PRICING: dict[str, ModelPricing] = {
    "gpt-5.5": ModelPricing(
        input_usd_per_1m=5.00,
        cached_input_usd_per_1m=0.50,
        output_usd_per_1m=30.00,
    ),
    "gpt-5.4": ModelPricing(
        input_usd_per_1m=2.50,
        cached_input_usd_per_1m=0.25,
        output_usd_per_1m=15.00,
    ),
    "gpt-5.4-mini": ModelPricing(
        input_usd_per_1m=0.75,
        cached_input_usd_per_1m=0.075,
        output_usd_per_1m=4.50,
    ),
    "gpt-5.4-nano": ModelPricing(
        input_usd_per_1m=0.20,
        cached_input_usd_per_1m=0.02,
        output_usd_per_1m=1.25,
    ),
}


def estimate_costs(
    usage: list[TokenUsage],
    *,
    usd_brl_rate: float | None = None,
) -> list[CostEstimate]:
    usd = estimate_usd(usage)
    estimates = [usd]
    rate = usd_brl_rate if usd_brl_rate is not None else _env_float("OGHMA_USD_BRL_RATE")
    if rate:
        estimates.append(
            CostEstimate(
                currency="BRL",
                total=round(usd.total * rate, 6),
                details={"usd_brl_rate": rate},
            )
        )
    return estimates


def estimate_usd(usage: list[TokenUsage]) -> CostEstimate:
    total = 0.0
    uncached_input_tokens = 0
    cached_input_tokens = 0
    output_tokens = 0

    for item in usage:
        pricing = DEFAULT_PRICING.get(item.model)
        if pricing is None:
            continue
        cached = min(item.cached_input_tokens, item.input_tokens)
        uncached = max(0, item.input_tokens - cached)
        uncached_input_tokens += uncached
        cached_input_tokens += cached
        output_tokens += item.output_tokens
        total += (uncached / 1_000_000) * pricing.input_usd_per_1m
        total += (cached / 1_000_000) * pricing.cached_input_usd_per_1m
        total += (item.output_tokens / 1_000_000) * pricing.output_usd_per_1m

    return CostEstimate(
        currency="USD",
        total=round(total, 6),
        details={
            "uncached_input_tokens": float(uncached_input_tokens),
            "cached_input_tokens": float(cached_input_tokens),
            "output_tokens": float(output_tokens),
        },
    )


def _env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None
