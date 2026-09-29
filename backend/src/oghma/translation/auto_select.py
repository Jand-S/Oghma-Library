"""Automatic model-selection planning for translation jobs."""
from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol

from .contracts import TranslationContext, TranslationRunResult
from .editorial_eval import deterministic_metrics, pairwise_instructions, pairwise_response_format
from .grade_runner import aggregate_ranking
from .model_selection import ModelRecommendation
from .planner import DEFAULT_TRANSLATION_MODELS, build_translation_plan
from .pipeline import TranslationPipeline
from .pricing import estimate_usd, pricing_for_model
from .providers.base import TranslationProvider
from .segmenter import html_text


@dataclass(frozen=True)
class AutomaticSampleChapter:
    id: str
    number: float
    reason: str
    source_chars: int
    word_count: int = 0


@dataclass(frozen=True)
class AutomaticSelectionPlan:
    sample_chapters: list[AutomaticSampleChapter]
    candidate_models: list[str]
    estimated_sample_usd: float
    estimated_sample_brl: float | None
    recommendations: list[ModelRecommendation]
    estimated_editorial_grader_usd: float = 0.0
    estimated_editorial_grader_brl: float | None = None


@dataclass(frozen=True)
class CandidateChapter:
    id: str
    number: float
    html: str
    word_count: int = 0


@dataclass(frozen=True)
class AutomaticSampleResult:
    chapter_id: str
    chapter_number: float
    status: str
    score: float
    issue_count: int
    repair_attempts: int
    duration_seconds: float
    cost_usd: float
    metrics: dict[str, float | int]
    translated_html: str = ""


@dataclass(frozen=True)
class AutomaticModelTrial:
    model: str
    provider: str
    sample_results: list[AutomaticSampleResult]
    average_score: float
    total_cost_usd: float
    total_duration_seconds: float
    failure_count: int


ProviderForModel = Callable[[str], TranslationProvider]


class StructuredGrader(Protocol):
    async def request_structured(
        self,
        *,
        operation: str,
        instructions: str,
        input_payload: dict[str, Any],
        response_format: dict[str, Any],
        model: str | None = None,
    ) -> dict[str, Any]:
        ...

    def drain_usage_events(self) -> list:
        ...

    def drain_call_events(self) -> list:
        ...


GraderFactory = Callable[[str], StructuredGrader]


def build_automatic_selection_plan(
    chapters: list[CandidateChapter],
    *,
    mode: str = "balanced",
    candidate_models: list[str] | None = None,
    usd_brl_rate: float | None = None,
    max_samples: int = 4,
    max_models: int = 4,
    grader_models: list[str] | None = None,
) -> AutomaticSelectionPlan:
    if not chapters:
        return AutomaticSelectionPlan([], [], 0.0, None, [])

    ordered = sorted(chapters, key=lambda item: item.number)
    selected = select_sample_chapters(ordered, max_samples=max_samples)
    models = (candidate_models or DEFAULT_TRANSLATION_MODELS)[:max_models]
    sample_html = [chapter.html for chapter in selected]
    recommendations = build_translation_plan(
        sample_html,
        mode=mode,
        models=models,
        usd_brl_rate=usd_brl_rate,
    ).recommendations
    estimated_usd = round(sum(item.estimated_usd for item in recommendations), 6)
    estimated_grader_usd = estimate_pairwise_grading_usd(
        selected,
        candidate_count=len(models),
        grader_models=grader_models or [],
    )
    return AutomaticSelectionPlan(
        sample_chapters=[
            AutomaticSampleChapter(
                id=chapter.id,
                number=chapter.number,
                reason=_sample_reason(chapter, ordered),
                source_chars=len(chapter.html),
                word_count=chapter.word_count,
            )
            for chapter in selected
        ],
        candidate_models=models,
        estimated_sample_usd=estimated_usd,
        estimated_sample_brl=round(estimated_usd * usd_brl_rate, 6) if usd_brl_rate else None,
        recommendations=recommendations,
        estimated_editorial_grader_usd=estimated_grader_usd,
        estimated_editorial_grader_brl=round(estimated_grader_usd * usd_brl_rate, 6) if usd_brl_rate else None,
    )


def estimate_pairwise_grading_usd(
    sample_chapters: list[CandidateChapter],
    *,
    candidate_count: int,
    grader_models: list[str],
) -> float:
    if candidate_count < 2 or not grader_models:
        return 0.0
    pair_count = candidate_count * (candidate_count - 1) // 2
    total = 0.0
    for chapter in sample_chapters:
        chars = int(len(chapter.html) * 3.4)
        input_tokens = chars // 4 + 900
        for grader in grader_models:
            pricing = pricing_for_model(grader)
            if pricing is None:
                continue
            total += pair_count * input_tokens / 1_000_000 * pricing.input_usd_per_1m
            total += pair_count * 1_200 / 1_000_000 * pricing.output_usd_per_1m
    return round(total * 1.2, 6)


async def run_automatic_model_trials(
    chapters: list[CandidateChapter],
    *,
    candidate_models: list[str],
    provider_for_model: ProviderForModel,
    context: TranslationContext | None = None,
    max_samples: int = 4,
) -> list[AutomaticModelTrial]:
    selected = select_sample_chapters(sorted(chapters, key=lambda item: item.number), max_samples=max_samples)
    if not selected:
        return []

    trials: list[AutomaticModelTrial] = []
    translation_context = context or TranslationContext()
    for model in candidate_models:
        provider = provider_for_model(model)
        pipeline = TranslationPipeline(provider)
        sample_results: list[AutomaticSampleResult] = []
        for chapter in selected:
            try:
                result = await pipeline.translate_html(chapter.html, translation_context)
                sample_results.append(_sample_result(chapter, result))
            except Exception as exc:
                sample_results.append(
                    AutomaticSampleResult(
                        chapter_id=chapter.id,
                        chapter_number=chapter.number,
                        status="failed",
                        score=0.0,
                        issue_count=1,
                        repair_attempts=0,
                        duration_seconds=0.0,
                        cost_usd=0.0,
                        metrics={"error": 1},
                        translated_html="",
                    )
                )
        trials.append(_model_trial(model, getattr(provider, "id", ""), sample_results))
    return sorted(trials, key=lambda item: (item.average_score, -item.total_cost_usd), reverse=True)


def choose_trial_winner(trials: list[AutomaticModelTrial]) -> AutomaticModelTrial | None:
    if not trials:
        return None
    return max(trials, key=lambda item: (item.average_score, -item.total_cost_usd))


async def grade_automatic_trials_pairwise(
    chapters: list[CandidateChapter],
    trials: list[AutomaticModelTrial],
    *,
    grader_models: list[str],
    grader_factory: GraderFactory,
) -> list[dict[str, Any]]:
    source_by_id = {chapter.id: html_text(chapter.html) for chapter in chapters}
    by_chapter: dict[str, list[tuple[str, AutomaticSampleResult]]] = {}
    for trial in trials:
        for result in trial.sample_results:
            if result.status == "failed" or not result.translated_html:
                continue
            by_chapter.setdefault(result.chapter_id, []).append((trial.model, result))

    grades: list[dict[str, Any]] = []
    for chapter_id in sorted(by_chapter):
        candidates = sorted(by_chapter[chapter_id], key=lambda item: item[0])
        for left_index, (left_model, left) in enumerate(candidates):
            for right_model, right in candidates[left_index + 1:]:
                for grader_index, grader_model in enumerate(grader_models):
                    model_a, sample_a, model_b, sample_b = (
                        (left_model, left, right_model, right)
                        if grader_index % 2 == 0
                        else (right_model, right, left_model, left)
                    )
                    grader = grader_factory(grader_model)
                    started_at = datetime.now(timezone.utc)
                    try:
                        grade = await grader.request_structured(
                            operation="automatic_pairwise_grade",
                            instructions=pairwise_instructions(),
                            input_payload={
                                "source_english": source_by_id.get(chapter_id, ""),
                                "required_terminology": [],
                                "translation_a_ptbr": html_text(sample_a.translated_html),
                                "translation_b_ptbr": html_text(sample_b.translated_html),
                            },
                            response_format=pairwise_response_format(),
                            model=grader_model,
                        )
                        usage = _drain(grader, "drain_usage_events")
                        calls = _drain(grader, "drain_call_events")
                        winner_label = grade["winner"]
                        winner = model_a if winner_label == "A" else model_b if winner_label == "B" else "tie"
                        grades.append(
                            {
                                "case_id": chapter_id,
                                "grader": grader_model,
                                "model_a": model_a,
                                "model_b": model_b,
                                "winner": winner,
                                "confidence": grade["confidence"],
                                "scores": {
                                    model_a: grade["scores_a"],
                                    model_b: grade["scores_b"],
                                },
                                "critical_issues": {
                                    model_a: grade["critical_issues_a"],
                                    model_b: grade["critical_issues_b"],
                                },
                                "rationale": grade["rationale"],
                                "duration_seconds": round((datetime.now(timezone.utc) - started_at).total_seconds(), 6),
                                "usage": [getattr(item, "__dict__", item) for item in usage],
                                "provider_calls": [getattr(item, "__dict__", item) for item in calls],
                                "cost_usd": estimate_usd(usage).total,
                                "status": "succeeded",
                            }
                        )
                    except Exception as exc:
                        grades.append(
                            {
                                "case_id": chapter_id,
                                "grader": grader_model,
                                "model_a": model_a,
                                "model_b": model_b,
                                "status": "failed",
                                "error_type": type(exc).__name__,
                                "duration_seconds": round((datetime.now(timezone.utc) - started_at).total_seconds(), 6),
                            }
                        )
    return grades


def choose_editorial_winner(
    trials: list[AutomaticModelTrial],
    grades: list[dict[str, Any]],
) -> AutomaticModelTrial | None:
    ranking = aggregate_ranking(grades)
    if not ranking:
        return choose_trial_winner(trials)
    by_model = {trial.model: trial for trial in trials}
    for item in ranking:
        trial = by_model.get(str(item["model"]))
        if trial is not None:
            return trial
    return choose_trial_winner(trials)


def select_sample_chapters(chapters: list[CandidateChapter], *, max_samples: int = 4) -> list[CandidateChapter]:
    if len(chapters) <= max_samples:
        return chapters
    picks = [
        chapters[0],
        chapters[len(chapters) // 4],
        chapters[len(chapters) // 2],
        chapters[-1],
        max(chapters, key=lambda item: item.word_count or len(item.html)),
    ]
    unique: list[CandidateChapter] = []
    seen: set[float] = set()
    for chapter in picks:
        if chapter.number in seen:
            continue
        unique.append(chapter)
        seen.add(chapter.number)
        if len(unique) >= max_samples:
            break
    return sorted(unique, key=lambda item: item.number)


def _sample_reason(chapter: CandidateChapter, ordered: list[CandidateChapter]) -> str:
    if chapter.number == ordered[0].number:
        return "first"
    if chapter.number == ordered[-1].number:
        return "late"
    midpoint = ordered[len(ordered) // 2].number
    if chapter.number == midpoint:
        return "middle"
    dense = max(ordered, key=lambda item: item.word_count or len(item.html)).number
    if chapter.number == dense:
        return "dense"
    return "spread"


def _sample_result(chapter: CandidateChapter, result: TranslationRunResult) -> AutomaticSampleResult:
    metrics = deterministic_metrics(chapter.html, result.translated_html)
    cost_usd = round(
        sum(item.total for item in result.cost_estimates if item.currency == "USD"),
        6,
    )
    return AutomaticSampleResult(
        chapter_id=chapter.id,
        chapter_number=chapter.number,
        status=result.status,
        score=_score_result(result, metrics),
        issue_count=len(result.issues),
        repair_attempts=result.repair_attempts,
        duration_seconds=round(result.duration_seconds, 3),
        cost_usd=cost_usd,
        metrics=metrics,
        translated_html=result.translated_html,
    )


def _model_trial(model: str, provider: str, sample_results: list[AutomaticSampleResult]) -> AutomaticModelTrial:
    successful = [item for item in sample_results if item.status != "failed"]
    denominator = max(1, len(sample_results))
    return AutomaticModelTrial(
        model=model,
        provider=provider,
        sample_results=sample_results,
        average_score=round(sum(item.score for item in sample_results) / denominator, 6),
        total_cost_usd=round(sum(item.cost_usd for item in sample_results), 6),
        total_duration_seconds=round(sum(item.duration_seconds for item in sample_results), 3),
        failure_count=len(sample_results) - len(successful),
    )


def _score_result(result: TranslationRunResult, metrics: dict[str, float | int]) -> float:
    if result.status == "failed":
        return 0.0
    score = 100.0
    score -= len(result.issues) * 8.0
    score -= result.repair_attempts * 4.0
    score -= float(metrics.get("english_marker_rate", 0.0)) * 80.0
    score -= min(20.0, float(metrics.get("residual_source_ngram_count", 0)) * 2.5)
    ratio = float(metrics.get("length_ratio", 1.0))
    if ratio < 0.65:
        score -= (0.65 - ratio) * 50.0
    elif ratio > 1.85:
        score -= (ratio - 1.85) * 25.0
    if result.status == "draft_with_warnings":
        score -= 8.0
    return round(max(0.0, min(100.0, score)), 6)


def _drain(grader: StructuredGrader, method: str) -> list:
    drain = getattr(grader, method, None)
    if callable(drain):
        return drain()
    return []
