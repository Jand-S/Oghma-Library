"""Translation planning and model recommendation service."""
from __future__ import annotations

from dataclasses import dataclass

from .model_selection import (
    ModelQualityProfile,
    ModelRecommendation,
    estimate_chapter_tokens,
    estimate_chapter_tokens_from_metrics,
    recommend_models,
)


DEFAULT_TRANSLATION_MODELS = [
    "google/gemini-3-flash-preview",
    "gpt-5.4-mini",
    "gpt-4.1-mini",
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v4-flash",
]


DEFAULT_QUALITY_PROFILES: dict[str, ModelQualityProfile] = {
    "google/gemini-3-flash-preview": ModelQualityProfile(
        model="google/gemini-3-flash-preview",
        quality_score=81.75,
        gate_pass_rate=1.0,
        latency_seconds_per_chapter=21.83,
        notes=("Best signal in the OpenRouter chapter-007 pilot.",),
    ),
    "gpt-5.4-mini": ModelQualityProfile(
        model="gpt-5.4-mini",
        quality_score=79.583,
        gate_pass_rate=1.0,
        notes=("Best OpenAI mini score in the preliminary two-chapter pilot.",),
    ),
    "gpt-4.1-mini": ModelQualityProfile(
        model="gpt-4.1-mini",
        quality_score=77.938,
        gate_pass_rate=1.0,
        notes=("Strong low-cost OpenAI baseline, but had one semantic inversion in pilot review.",),
    ),
    "deepseek/deepseek-v4-pro": ModelQualityProfile(
        model="deepseek/deepseek-v4-pro",
        quality_score=77.958,
        gate_pass_rate=1.0,
        latency_seconds_per_chapter=224.39,
        notes=("Passed deterministic gates without repair in chapter-007 pilot, but was slow.",),
    ),
    "deepseek/deepseek-v4-flash": ModelQualityProfile(
        model="deepseek/deepseek-v4-flash",
        quality_score=79.417,
        gate_pass_rate=0.5,
        latency_seconds_per_chapter=98.35,
        experimental=True,
        notes=("Very cheap, but chapter-007 pilot had mojibake and glossary issues.",),
    ),
}


@dataclass(frozen=True)
class TranslationPlan:
    chapter_count: int
    source_chars: int
    estimated_input_tokens: int
    estimated_output_tokens: int
    mode: str
    recommendations: list[ModelRecommendation]


def build_translation_plan(
    chapter_html: list[str],
    *,
    mode: str = "balanced",
    models: list[str] | None = None,
    usd_brl_rate: float | None = None,
) -> TranslationPlan:
    estimate = estimate_chapter_tokens(chapter_html)
    selected_models = models or DEFAULT_TRANSLATION_MODELS
    recommendations = recommend_models(
        estimate,
        selected_models,
        quality_profiles=DEFAULT_QUALITY_PROFILES,
        mode=mode,
        usd_brl_rate=usd_brl_rate,
    )
    return TranslationPlan(
        chapter_count=estimate.chapter_count,
        source_chars=estimate.source_chars,
        estimated_input_tokens=estimate.estimated_input_tokens,
        estimated_output_tokens=estimate.estimated_output_tokens,
        mode=mode,
        recommendations=recommendations,
    )


def build_translation_plan_from_metrics(
    *,
    chapter_count: int,
    source_chars: int,
    mode: str = "balanced",
    models: list[str] | None = None,
    usd_brl_rate: float | None = None,
) -> TranslationPlan:
    estimate = estimate_chapter_tokens_from_metrics(
        chapter_count=chapter_count,
        source_chars=source_chars,
    )
    recommendations = recommend_models(
        estimate,
        models or DEFAULT_TRANSLATION_MODELS,
        quality_profiles=DEFAULT_QUALITY_PROFILES,
        mode=mode,
        usd_brl_rate=usd_brl_rate,
    )
    return TranslationPlan(
        chapter_count=estimate.chapter_count,
        source_chars=estimate.source_chars,
        estimated_input_tokens=estimate.estimated_input_tokens,
        estimated_output_tokens=estimate.estimated_output_tokens,
        mode=mode,
        recommendations=recommendations,
    )
