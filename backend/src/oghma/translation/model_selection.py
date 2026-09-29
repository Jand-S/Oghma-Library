"""Model cost and recommendation helpers for translation jobs."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from .pricing import ModelPricing, pricing_snapshot_for_model


@dataclass(frozen=True)
class ChapterTokenEstimate:
    chapter_count: int
    source_chars: int
    estimated_source_tokens: int
    estimated_input_tokens: int
    estimated_output_tokens: int


@dataclass(frozen=True)
class ModelQualityProfile:
    model: str
    quality_score: float | None = None
    gate_pass_rate: float | None = None
    latency_seconds_per_chapter: float | None = None
    experimental: bool = False
    notes: tuple[str, ...] = ()


@dataclass(frozen=True)
class ModelRecommendation:
    model: str
    estimated_usd: float
    estimated_brl: float | None
    estimated_duration_seconds: float | None
    quality_score: float | None
    gate_pass_rate: float | None
    recommendation_score: float
    experimental: bool
    price_timestamp: str
    notes: tuple[str, ...] = ()


MODE_WEIGHTS: dict[str, dict[str, float]] = {
    "economy": {"quality": 0.35, "cost": 0.45, "latency": 0.10, "gate": 0.10},
    "balanced": {"quality": 0.45, "cost": 0.25, "latency": 0.10, "gate": 0.20},
    "quality": {"quality": 0.60, "cost": 0.10, "latency": 0.05, "gate": 0.25},
    "fast": {"quality": 0.35, "cost": 0.15, "latency": 0.35, "gate": 0.15},
}


def estimate_chapter_tokens(
    chapter_html: list[str],
    *,
    context_tokens_per_chapter: int = 1_200,
    output_ratio: float = 1.2,
) -> ChapterTokenEstimate:
    source_chars = sum(len(item) for item in chapter_html)
    estimated_source_tokens = max(1, source_chars // 4)
    chapter_count = len(chapter_html)
    estimated_input_tokens = estimated_source_tokens + (context_tokens_per_chapter * chapter_count)
    estimated_output_tokens = int(estimated_source_tokens * output_ratio)
    return ChapterTokenEstimate(
        chapter_count=chapter_count,
        source_chars=source_chars,
        estimated_source_tokens=estimated_source_tokens,
        estimated_input_tokens=estimated_input_tokens,
        estimated_output_tokens=estimated_output_tokens,
    )


def estimate_chapter_tokens_from_metrics(
    *,
    chapter_count: int,
    source_chars: int,
    context_tokens_per_chapter: int = 1_200,
    output_ratio: float = 1.2,
) -> ChapterTokenEstimate:
    safe_chapter_count = max(1, chapter_count)
    safe_source_chars = max(1, source_chars)
    estimated_source_tokens = max(1, safe_source_chars // 4)
    return ChapterTokenEstimate(
        chapter_count=safe_chapter_count,
        source_chars=safe_source_chars,
        estimated_source_tokens=estimated_source_tokens,
        estimated_input_tokens=estimated_source_tokens
        + (context_tokens_per_chapter * safe_chapter_count),
        estimated_output_tokens=int(estimated_source_tokens * output_ratio),
    )


def recommend_models(
    estimate: ChapterTokenEstimate,
    models: list[str],
    *,
    quality_profiles: dict[str, ModelQualityProfile] | None = None,
    mode: str = "balanced",
    usd_brl_rate: float | None = None,
    pricing: dict[str, ModelPricing] | None = None,
    price_timestamp: datetime | None = None,
) -> list[ModelRecommendation]:
    snapshots = {
        model: snapshot
        for model in models
        if (snapshot := pricing_snapshot_for_model(model)) is not None
    }
    model_pricing = pricing or {
        model: snapshot.to_model_pricing() for model, snapshot in snapshots.items()
    }
    profiles = quality_profiles or {}
    dynamic_timestamps = [
        datetime.fromisoformat(snapshot.fetched_at) for snapshot in snapshots.values()
    ]
    effective_timestamp = price_timestamp or (
        min(dynamic_timestamps) if dynamic_timestamps else datetime.now(timezone.utc)
    )
    timestamp = effective_timestamp.isoformat()
    raw: list[tuple[str, float, ModelQualityProfile]] = []
    for model in models:
        price = model_pricing.get(model)
        if price is None:
            continue
        profile = profiles.get(model, ModelQualityProfile(model=model))
        raw.append((model, _estimate_usd(estimate, price), profile))

    if not raw:
        return []

    max_cost = max(cost for _, cost, _ in raw) or 1.0
    max_latency = max((profile.latency_seconds_per_chapter or 0.0) for _, _, profile in raw) or 1.0
    weights = MODE_WEIGHTS.get(mode, MODE_WEIGHTS["balanced"])
    recommendations = [
        _recommendation(
            estimate=estimate,
            model=model,
            usd=usd,
            max_cost=max_cost,
            max_latency=max_latency,
            profile=profile,
            weights=weights,
            usd_brl_rate=usd_brl_rate,
            price_timestamp=timestamp,
        )
        for model, usd, profile in raw
    ]
    return sorted(recommendations, key=lambda item: item.recommendation_score, reverse=True)


def _recommendation(
    *,
    estimate: ChapterTokenEstimate,
    model: str,
    usd: float,
    max_cost: float,
    max_latency: float,
    profile: ModelQualityProfile,
    weights: dict[str, float],
    usd_brl_rate: float | None,
    price_timestamp: str,
) -> ModelRecommendation:
    quality = (profile.quality_score or 70.0) / 100.0
    gate = profile.gate_pass_rate if profile.gate_pass_rate is not None else 0.85
    latency_per_chapter = profile.latency_seconds_per_chapter
    equivalent_chapter_count = max(
        estimate.chapter_count,
        estimate.estimated_source_tokens / 2_600,
    )
    total_latency = (
        latency_per_chapter * equivalent_chapter_count
        if latency_per_chapter is not None
        else None
    )
    normalized_cost = usd / max_cost if max_cost else 0.0
    normalized_latency = (latency_per_chapter or max_latency) / max_latency if max_latency else 0.0
    score = (
        quality * weights["quality"]
        + gate * weights["gate"]
        + (1.0 - normalized_cost) * weights["cost"]
        + (1.0 - normalized_latency) * weights["latency"]
    )
    if profile.experimental:
        score -= 0.15
    return ModelRecommendation(
        model=model,
        estimated_usd=round(usd, 6),
        estimated_brl=round(usd * usd_brl_rate, 6) if usd_brl_rate else None,
        estimated_duration_seconds=round(total_latency, 3) if total_latency is not None else None,
        quality_score=profile.quality_score,
        gate_pass_rate=profile.gate_pass_rate,
        recommendation_score=round(score, 6),
        experimental=profile.experimental,
        price_timestamp=price_timestamp,
        notes=profile.notes,
    )


def _estimate_usd(estimate: ChapterTokenEstimate, pricing: ModelPricing) -> float:
    total = estimate.estimated_input_tokens / 1_000_000 * pricing.input_usd_per_1m
    total += estimate.estimated_output_tokens / 1_000_000 * pricing.output_usd_per_1m
    return total
