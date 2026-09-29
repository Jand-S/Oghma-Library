"""Sequential translation job executor."""
from __future__ import annotations

import asyncio
import json
import os
import re
import time
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

from ..config import get_settings
from .auto_select import (
    AutomaticModelTrial,
    CandidateChapter,
    GraderFactory,
    choose_editorial_winner,
    choose_trial_winner,
    grade_automatic_trials_pairwise,
    run_automatic_model_trials,
)
from .contracts import TranslationContext, TranslationRunResult
from .coverage import TranslationChapterRecord, upsert_coverage_record
from .jobs import TranslationJob, TranslationJobStats, update_translation_job_stats, upsert_translation_job
from .memory import MemoryChapter, update_memory_from_chapters
from .pipeline import TranslationPipeline
from .planner import DEFAULT_TRANSLATION_MODELS
from .providers import FakeTranslationProvider, OpenAIProvider, OpenRouterProvider
from .providers.base import TranslationProvider
from .selection_history import (
    AutomaticSelectionRecord,
    AutomaticSelectionTrialSummary,
    append_selection_record,
    winning_models_for_novel,
)


@dataclass(frozen=True)
class TranslationWorkChapter:
    id: str
    number: float
    html: str
    content_hash: str | None = None


ProviderFactory = Callable[[TranslationJob], TranslationProvider]
JobUpdateCallback = Callable[[TranslationJob], Awaitable[None]]
ChapterUpdateCallback = Callable[[TranslationChapterRecord], Awaitable[None]]


def provider_for_job(job: TranslationJob) -> TranslationProvider:
    if job.provider == "fake":
        return FakeTranslationProvider()
    if job.provider == "openrouter":
        return OpenRouterProvider.from_env(model=job.selected_model)
    return OpenAIProvider.from_env(model=job.selected_model)


async def execute_translation_job(
    job: TranslationJob,
    chapters: list[TranslationWorkChapter],
    provider_factory: ProviderFactory,
    *,
    context: TranslationContext | None = None,
    output_root: Path | None = None,
    jobs_index_path: Path | None = None,
    coverage_index_path: Path | None = None,
    selection_history_path: Path | None = None,
    memory_index_path: Path | None = None,
    editorial_grader_factory: GraderFactory | None = None,
    editorial_grader_models: list[str] | None = None,
    on_job_update: JobUpdateCallback | None = None,
    on_chapter_update: ChapterUpdateCallback | None = None,
    max_cost_per_minute_usd: float | None = None,
) -> TranslationJob:
    if not chapters:
        return await _update_job(
            on_job_update,
            job.id,
            job.stats,
            status="failed",
            error="job has no downloaded chapters to translate",
            path=jobs_index_path,
        )

    run_started_monotonic = time.monotonic()
    stats = replace(
        job.stats,
        selected_count=len(chapters),
        effective_worker_count=max(1, job.worker_count),
        progress_percent=0.0,
        telemetry_reason="Job iniciado; aguardando primeiras metricas reais.",
    )
    await _update_job(
        on_job_update,
        job.id,
        stats,
        status="translating",
        path=jobs_index_path,
    )
    translation_context = _translation_context_for_job(job, chapters, context, memory_index_path)

    if job.strategy == "automatic":
        job = await _resolve_automatic_job(
            job,
            chapters,
            provider_factory,
            context=translation_context,
            output_root=output_root,
            jobs_index_path=jobs_index_path,
            selection_history_path=selection_history_path,
            editorial_grader_factory=editorial_grader_factory,
            editorial_grader_models=editorial_grader_models,
            on_job_update=on_job_update,
        )
        if job.status == "failed":
            return job
        stats = job.stats
        await _update_job(
            on_job_update,
            job.id,
            stats,
            status="translating",
            path=jobs_index_path,
        )

    translated_count = 0
    failed_count = job.stats.failed_count
    retry_count = job.stats.retry_count
    repair_count = job.stats.repair_count
    rate_limit_count = job.stats.rate_limit_count
    actual_cost_usd = job.stats.actual_cost_usd
    actual_cost_brl = job.stats.actual_cost_brl
    input_tokens = 0
    output_tokens = 0
    provider_call_count = 0
    provider_error_count = 0
    root = output_root or _default_output_root()
    ordered_chapters = sorted(chapters, key=lambda item: item.number)
    max_concurrency = max(1, job.worker_count)
    concurrency = max_concurrency
    stable_batch_count = 0
    cost_per_minute_limit = (
        max_cost_per_minute_usd
        if max_cost_per_minute_usd is not None
        else _env_float("OGHMA_TRANSLATION_MAX_COST_PER_MINUTE_USD")
    )

    batch_start = 0
    while batch_start < len(ordered_chapters):
        current = _load_current_job(job.id, jobs_index_path)
        if current.status in {"paused", "cancelled"}:
            return current
        batch = ordered_chapters[batch_start:batch_start + concurrency]
        try:
            batch_results = await asyncio.gather(
                *[
                    _translate_chapter(job, chapter, provider_factory, translation_context)
                    for chapter in batch
                ],
            )
        except Exception as exc:
            return await _update_job(
                on_job_update,
                job.id,
                stats,
                status="failed",
                error=f"{type(exc).__name__}: {exc}",
                path=jobs_index_path,
            )

        for chapter, result in sorted(batch_results, key=lambda item: item[0].number):
            current = _load_current_job(job.id, jobs_index_path)
            if current.status in {"paused", "cancelled"}:
                return current
            try:
                output_path = _output_path(root, job, chapter)
                sidecar_path = output_path.with_suffix(output_path.suffix + ".json")
                output_path.parent.mkdir(parents=True, exist_ok=True)
                if result.translated_html:
                    output_path.write_text(result.translated_html, encoding="utf-8")
                _write_sidecar(sidecar_path, job, chapter, result)
                if result.translated_html and result.status != "failed":
                    coverage_record = TranslationChapterRecord(
                            novel_id=job.novel_id,
                            chapter_id=chapter.id,
                            chapter_number=chapter.number,
                            target_language=job.target_language,
                            status=result.status,
                            translated_path=str(output_path),
                            sidecar_path=str(sidecar_path),
                            source_hash=chapter.content_hash,
                            translated_hash=_hash_or_empty(result.translated_html),
                            model=job.selected_model,
                            provider=job.provider,
                            public_reusable=True,
                            origin="job",
                            updated_at=datetime.now(timezone.utc).isoformat(),
                    )
                    upsert_coverage_record(coverage_record, coverage_index_path)
                    if on_chapter_update is not None:
                        await on_chapter_update(coverage_record)
                translated_count += 1 if result.status != "failed" else 0
                failed_count += 1 if result.status == "failed" else 0
                repair_count += result.repair_attempts
                retry_count += _retry_count(result)
                rate_limit_count += _rate_limit_count(result)
                input_tokens += sum(item.input_tokens for item in result.usage)
                output_tokens += sum(item.output_tokens for item in result.usage)
                provider_call_count += len(result.provider_calls)
                provider_error_count += sum(
                    1
                    for call in result.provider_calls
                    if call.status not in {"success", "succeeded"}
                )
                for estimate in result.cost_estimates:
                    if estimate.currency == "USD":
                        actual_cost_usd += estimate.total
                    elif estimate.currency == "BRL":
                        actual_cost_brl = (actual_cost_brl or 0.0) + estimate.total
                completed_count = translated_count + failed_count
                stats = _telemetry_stats(
                    stats,
                    completed_count=completed_count,
                    translated_count=translated_count,
                    failed_count=failed_count,
                    retry_count=retry_count,
                    repair_count=repair_count,
                    rate_limit_count=rate_limit_count,
                    actual_cost_usd=actual_cost_usd,
                    actual_cost_brl=actual_cost_brl,
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    provider_call_count=provider_call_count,
                    provider_error_count=provider_error_count,
                    chapter_count=len(chapters),
                    run_started_monotonic=run_started_monotonic,
                    effective_worker_count=concurrency,
                )
                if job.max_cost_usd is not None and stats.actual_cost_usd > job.max_cost_usd:
                    return await _update_job(
                        on_job_update,
                        job.id,
                        stats,
                        status="failed",
                        error=(
                            f"actual cost ${stats.actual_cost_usd:.6f} exceeded "
                            f"budget ${job.max_cost_usd:.6f}"
                        ),
                        path=jobs_index_path,
                    )
                await _update_job(
                    on_job_update,
                    job.id,
                    stats,
                    status="translating",
                    path=jobs_index_path,
                )
            except Exception as exc:
                return await _update_job(
                    on_job_update,
                    job.id,
                    stats,
                    status="failed",
                    error=f"{type(exc).__name__}: {exc}",
                    path=jobs_index_path,
                )
        stable_batch_count = (
            stable_batch_count + 1 if _batch_is_stable(batch_results) else 0
        )
        next_concurrency, adaptation_reason = _next_concurrency(
            concurrency,
            max_concurrency,
            batch_results,
            stable_batch_count=stable_batch_count,
            cost_per_minute_usd=stats.cost_per_minute_usd,
            max_cost_per_minute_usd=cost_per_minute_limit,
            provider_stability_percent=stats.provider_stability_percent,
        )
        if next_concurrency != concurrency:
            concurrency = next_concurrency
            stats = replace(
                stats,
                effective_worker_count=concurrency,
                telemetry_reason=adaptation_reason,
            )
            await _update_job(
                on_job_update,
                job.id,
                stats,
                status="translating",
                path=jobs_index_path,
            )
        batch_start += len(batch)

    return await _update_job(
        on_job_update,
        job.id,
        stats,
        status="done",
        path=jobs_index_path,
    )


async def _translate_chapter(
    job: TranslationJob,
    chapter: TranslationWorkChapter,
    provider_factory: ProviderFactory,
    context: TranslationContext,
) -> tuple[TranslationWorkChapter, TranslationRunResult]:
    provider = provider_factory(job)
    pipeline = TranslationPipeline(provider)
    return chapter, await pipeline.translate_html(chapter.html, context)


async def _resolve_automatic_job(
    job: TranslationJob,
    chapters: list[TranslationWorkChapter],
    provider_factory: ProviderFactory,
    *,
    context: TranslationContext | None,
    output_root: Path | None,
    jobs_index_path: Path | None,
    selection_history_path: Path | None,
    editorial_grader_factory: GraderFactory | None,
    editorial_grader_models: list[str] | None,
    on_job_update: JobUpdateCallback | None,
) -> TranslationJob:
    await _update_job(
        on_job_update,
        job.id,
        job.stats,
        status="sampling",
        path=jobs_index_path,
    )
    candidates = [
        CandidateChapter(id=chapter.id, number=chapter.number, html=chapter.html)
        for chapter in chapters
    ]

    def provider_for_model(model: str) -> TranslationProvider:
        candidate_job = replace(
            job,
            selected_model=model,
            provider=_provider_for_candidate_model(model, fallback=job.provider),
        )
        return provider_factory(candidate_job)

    trials = await run_automatic_model_trials(
        candidates,
        candidate_models=_candidate_models_for_job(job, selection_history_path),
        provider_for_model=provider_for_model,
        context=context or TranslationContext(target_language=job.target_language),
        max_samples=min(4, len(chapters)),
    )
    editorial_grades = []
    if editorial_grader_factory and editorial_grader_models:
        editorial_grades = await grade_automatic_trials_pairwise(
            candidates,
            trials,
            grader_models=editorial_grader_models,
            grader_factory=editorial_grader_factory,
        )
    winner = choose_editorial_winner(trials, editorial_grades) if editorial_grades else choose_trial_winner(trials)
    _write_selection_sidecar(_selection_path(output_root or _default_output_root(), job), job, trials, winner, editorial_grades)
    if winner is None:
        return await _update_job(
            on_job_update,
            job.id,
            job.stats,
            status="failed",
            error="automatic selection produced no model trials",
            path=jobs_index_path,
        )
    resolved = replace(
        job,
        selected_model=winner.model,
        provider=winner.provider or _provider_for_candidate_model(winner.model, fallback=job.provider),
    )
    append_selection_record(_selection_record(resolved, trials, winner, editorial_grades), selection_history_path)
    upsert_translation_job(resolved, jobs_index_path)
    if on_job_update is not None:
        await on_job_update(resolved)
    return resolved


async def _update_job(
    callback: JobUpdateCallback | None,
    job_id: str,
    stats: TranslationJobStats,
    *,
    status: str | None = None,
    error: str = "",
    path: Path | None = None,
) -> TranslationJob:
    updated = update_translation_job_stats(
        job_id,
        stats,
        status=status,
        error=error,
        path=path,
    )
    if callback is not None:
        await callback(updated)
    return updated


def _load_current_job(job_id: str, path: Path | None) -> TranslationJob:
    from .jobs import get_translation_job

    current = get_translation_job(job_id, path)
    if current is None:
        raise KeyError(job_id)
    return current


def _translation_context_for_job(
    job: TranslationJob,
    chapters: list[TranslationWorkChapter],
    context: TranslationContext | None,
    memory_index_path: Path | None,
) -> TranslationContext:
    base = context or TranslationContext(target_language=job.target_language)
    memory_terms = update_memory_from_chapters(
        job.novel_id,
        [
            MemoryChapter(id=chapter.id, number=chapter.number, html=chapter.html)
            for chapter in chapters
        ],
        memory_index_path,
    )
    existing = {(term.source.lower(), term.target.lower()) for term in base.glossary_terms}
    merged = [
        *base.glossary_terms,
        *[
            term
            for term in memory_terms
            if (term.source.lower(), term.target.lower()) not in existing
        ],
    ]
    return replace(base, glossary_terms=merged)


def _default_output_root() -> Path:
    return Path(get_settings().storage_root) / "translations" / "outputs"


def _safe(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-") or "x"


def _output_path(root: Path, job: TranslationJob, chapter: TranslationWorkChapter) -> Path:
    number = f"{chapter.number:g}"
    return root / _safe(job.novel_id) / _safe(job.target_language) / f"chapter-{number}.html"


def _selection_path(root: Path, job: TranslationJob) -> Path:
    return root / _safe(job.novel_id) / _safe(job.target_language) / f"job-{_safe(job.id)}.automatic-selection.json"


def _provider_for_candidate_model(model: str, *, fallback: str) -> str:
    if fallback == "fake":
        return "fake"
    if model.startswith(("google/", "deepseek/", "anthropic/")):
        return "openrouter"
    if model.startswith("gpt-"):
        return "openai"
    return fallback if fallback and fallback != "auto" else "openai"


def _candidate_models_for_job(job: TranslationJob, selection_history_path: Path | None) -> list[str]:
    historical = winning_models_for_novel(
        job.novel_id,
        target_language=job.target_language,
        path=selection_history_path,
    )
    return [*historical, *[model for model in DEFAULT_TRANSLATION_MODELS if model not in historical]]


def _retry_count(result: TranslationRunResult) -> int:
    return sum(max(0, call.attempt - 1) for call in result.provider_calls)


def _rate_limit_count(result: TranslationRunResult) -> int:
    return sum(
        1
        for call in result.provider_calls
        if call.http_status == 429 or (call.error_type or "").lower() in {"rate_limit", "ratelimit", "rate-limit"}
    )


def _next_concurrency(
    current: int,
    max_concurrency: int,
    batch_results: list[tuple[TranslationWorkChapter, TranslationRunResult]],
    *,
    stable_batch_count: int = 0,
    cost_per_minute_usd: float = 0.0,
    max_cost_per_minute_usd: float | None = None,
    provider_stability_percent: float = 100.0,
) -> tuple[int, str]:
    if max_concurrency <= 1:
        return 1, "Paralelismo mantido em 1 worker."
    had_failure = any(result.status == "failed" for _, result in batch_results)
    had_rate_limit = any(_rate_limit_count(result) > 0 for _, result in batch_results)
    had_retry = any(_retry_count(result) > 0 for _, result in batch_results)
    if had_failure or had_rate_limit:
        return max(1, current - 1), "Paralelismo reduzido por falha ou rate limit do provider."
    if had_retry:
        return max(1, current - 1), "Paralelismo reduzido por Retries do provider."
    if max_cost_per_minute_usd and cost_per_minute_usd > max_cost_per_minute_usd:
        return max(1, current - 1), (
            f"Paralelismo reduzido: custo por minuto ${cost_per_minute_usd:.4f} "
            f"acima do limite ${max_cost_per_minute_usd:.4f}."
        )
    if provider_stability_percent < 90:
        return max(1, current - 1), (
            f"Paralelismo reduzido: estabilidade do provider em {provider_stability_percent:.1f}%."
        )
    if current < max_concurrency and stable_batch_count >= 2:
        return current + 1, "Paralelismo aumentado apos dois lotes estaveis."
    return current, "Paralelismo mantido enquanto a estabilidade e observada."


def _batch_is_stable(
    batch_results: list[tuple[TranslationWorkChapter, TranslationRunResult]],
) -> bool:
    return all(
        result.status != "failed"
        and _rate_limit_count(result) == 0
        and _retry_count(result) == 0
        for _, result in batch_results
    )


def _telemetry_stats(
    stats: TranslationJobStats,
    *,
    completed_count: int,
    translated_count: int,
    failed_count: int,
    retry_count: int,
    repair_count: int,
    rate_limit_count: int,
    actual_cost_usd: float,
    actual_cost_brl: float | None,
    input_tokens: int,
    output_tokens: int,
    provider_call_count: int,
    provider_error_count: int,
    chapter_count: int,
    run_started_monotonic: float,
    effective_worker_count: int,
) -> TranslationJobStats:
    elapsed_seconds = max(0.001, time.monotonic() - run_started_monotonic)
    remaining_count = max(0, chapter_count - completed_count)
    average_seconds = elapsed_seconds / max(1, completed_count)
    average_cost = actual_cost_usd / max(1, completed_count)
    average_input_tokens = input_tokens / max(1, completed_count)
    average_output_tokens = output_tokens / max(1, completed_count)
    output_input_ratio = output_tokens / input_tokens if input_tokens else 0.0
    cost_per_minute = actual_cost_usd / (elapsed_seconds / 60)
    retry_rate = (retry_count / max(1, completed_count)) * 100
    repair_rate = (repair_count / max(1, completed_count)) * 100
    provider_stability = (
        ((provider_call_count - provider_error_count) / provider_call_count) * 100
        if provider_call_count
        else (0.0 if failed_count else 100.0)
    )
    estimated_remaining_usd = average_cost * remaining_count if completed_count else max(0.0, stats.estimated_cost_usd)
    estimated_remaining_brl = None
    if actual_cost_brl is not None:
        average_brl = actual_cost_brl / max(1, completed_count)
        estimated_remaining_brl = average_brl * remaining_count
    elif stats.estimated_cost_brl is not None and stats.estimated_cost_usd > 0:
        estimated_remaining_brl = estimated_remaining_usd * (stats.estimated_cost_brl / stats.estimated_cost_usd)
    eta_seconds = average_seconds * remaining_count if completed_count else None
    progress_percent = (completed_count / max(1, chapter_count)) * 100
    return replace(
        stats,
        translated_count=translated_count,
        failed_count=failed_count,
        retry_count=retry_count,
        repair_count=repair_count,
        rate_limit_count=rate_limit_count,
        actual_cost_usd=round(actual_cost_usd, 6),
        actual_cost_brl=round(actual_cost_brl, 6) if actual_cost_brl is not None else None,
        estimated_remaining_cost_usd=round(estimated_remaining_usd, 6),
        estimated_remaining_cost_brl=round(estimated_remaining_brl, 6) if estimated_remaining_brl is not None else None,
        average_cost_usd_per_chapter=round(average_cost, 6),
        average_input_tokens_per_chapter=round(average_input_tokens, 2),
        average_output_tokens_per_chapter=round(average_output_tokens, 2),
        output_input_ratio=round(output_input_ratio, 4),
        average_seconds_per_chapter=round(average_seconds, 3),
        cost_per_minute_usd=round(cost_per_minute, 6),
        elapsed_seconds=round(elapsed_seconds, 3),
        eta_seconds=round(eta_seconds, 3) if eta_seconds is not None else None,
        retry_rate_percent=round(retry_rate, 2),
        repair_rate_percent=round(repair_rate, 2),
        provider_stability_percent=round(provider_stability, 2),
        effective_worker_count=effective_worker_count,
        progress_percent=round(progress_percent, 3),
        telemetry_reason=_telemetry_reason(
            estimated_cost_usd=stats.estimated_cost_usd,
            actual_cost_usd=actual_cost_usd,
            estimated_remaining_usd=estimated_remaining_usd,
            retry_count=retry_count,
            repair_count=repair_count,
            rate_limit_count=rate_limit_count,
            effective_worker_count=effective_worker_count,
        ),
    )


def _telemetry_reason(
    *,
    estimated_cost_usd: float,
    actual_cost_usd: float,
    estimated_remaining_usd: float,
    retry_count: int,
    repair_count: int,
    rate_limit_count: int,
    effective_worker_count: int,
) -> str:
    projected = actual_cost_usd + estimated_remaining_usd
    if rate_limit_count:
        return f"Rate limit detectado; workers efetivos ajustados para {effective_worker_count}."
    if retry_count:
        return f"Retries detectados; custo/tempo podem ficar acima da estimativa. Workers efetivos: {effective_worker_count}."
    if repair_count:
        return "Reparos automaticos aumentaram o tempo medio por capitulo."
    if estimated_cost_usd > 0 and projected > estimated_cost_usd * 1.2:
        return "Custo projetado subiu porque os capitulos recentes ficaram mais caros que a estimativa inicial."
    if estimated_cost_usd > 0 and projected < estimated_cost_usd * 0.8:
        return "Custo projetado caiu porque os capitulos recentes ficaram mais baratos que a estimativa inicial."
    return "Estimativa ajustada com base nos capitulos ja processados."


def _env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if not raw:
        return None
    try:
        return float(raw.replace(",", "."))
    except ValueError:
        return None


def _write_selection_sidecar(
    path: Path,
    job: TranslationJob,
    trials: list[AutomaticModelTrial],
    winner: AutomaticModelTrial | None,
    editorial_grades: list[dict] | None = None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "job_id": job.id,
                "novel_id": job.novel_id,
                "target_language": job.target_language,
                "winner": winner.model if winner else None,
                "editorial_grade_count": len(editorial_grades or []),
                "editorial_grades": editorial_grades or [],
                "trials": [
                    {
                        "model": trial.model,
                        "provider": trial.provider,
                        "average_score": trial.average_score,
                        "total_cost_usd": trial.total_cost_usd,
                        "total_duration_seconds": trial.total_duration_seconds,
                        "failure_count": trial.failure_count,
                        "sample_results": [item.__dict__ for item in trial.sample_results],
                    }
                    for trial in trials
                ],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _selection_record(
    job: TranslationJob,
    trials: list[AutomaticModelTrial],
    winner: AutomaticModelTrial,
    editorial_grades: list[dict] | None = None,
) -> AutomaticSelectionRecord:
    grades = editorial_grades or []
    return AutomaticSelectionRecord(
        id=f"{job.id}:{winner.model}",
        job_id=job.id,
        novel_id=job.novel_id,
        chapter_from=job.chapter_from,
        chapter_to=job.chapter_to,
        target_language=job.target_language,
        mode=job.mode,
        winner_model=winner.model,
        winner_provider=winner.provider,
        editorial_grade_count=sum(1 for item in grades if item.get("status") == "succeeded"),
        editorial_cost_usd=round(sum(float(item.get("cost_usd", 0.0)) for item in grades), 6),
        sample_chapters=[
            result.chapter_number
            for trial in trials[:1]
            for result in trial.sample_results
        ],
        trials=[
            AutomaticSelectionTrialSummary(
                model=trial.model,
                provider=trial.provider,
                average_score=trial.average_score,
                total_cost_usd=trial.total_cost_usd,
                total_duration_seconds=trial.total_duration_seconds,
                failure_count=trial.failure_count,
            )
            for trial in trials
        ],
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def _write_sidecar(
    path: Path,
    job: TranslationJob,
    chapter: TranslationWorkChapter,
    result: TranslationRunResult,
) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "job_id": job.id,
                "novel_id": job.novel_id,
                "chapter_id": chapter.id,
                "chapter_number": chapter.number,
                "target_language": job.target_language,
                "status": result.status,
                "issue_count": len(result.issues),
                "repair_attempts": result.repair_attempts,
                "usage": [item.__dict__ for item in result.usage],
                "cost_estimates": [item.__dict__ for item in result.cost_estimates],
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def _hash_or_empty(value: str) -> str:
    import hashlib

    return hashlib.sha256(value.encode("utf-8")).hexdigest()
