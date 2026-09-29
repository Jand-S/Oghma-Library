"""Persistent translation job registry.

The MVP stores jobs in a JSON index so the API/UI contract can mature before the
translation tables are moved to the main database.
"""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from ..config import get_settings
from .coverage import CoverageRange, TranslationCoverage
from .json_index import mutate_json_index, read_json_index, write_json_index

JOB_STATUSES = {
    "queued",
    "planning",
    "sampling",
    "translating",
    "repairing",
    "paused",
    "failed",
    "done",
    "cancelled",
}


@dataclass(frozen=True)
class TranslationJobStats:
    selected_count: int = 0
    translated_count: int = 0
    reusable_count: int = 0
    missing_count: int = 0
    stale_count: int = 0
    unknown_count: int = 0
    estimated_savings_usd: float = 0.0
    estimated_savings_brl: float | None = None
    estimated_cost_usd: float = 0.0
    estimated_cost_brl: float | None = None
    actual_cost_usd: float = 0.0
    actual_cost_brl: float | None = None
    estimated_remaining_cost_usd: float = 0.0
    estimated_remaining_cost_brl: float | None = None
    average_cost_usd_per_chapter: float = 0.0
    average_input_tokens_per_chapter: float = 0.0
    average_output_tokens_per_chapter: float = 0.0
    output_input_ratio: float = 0.0
    average_seconds_per_chapter: float = 0.0
    cost_per_minute_usd: float = 0.0
    elapsed_seconds: float = 0.0
    eta_seconds: float | None = None
    retry_count: int = 0
    repair_count: int = 0
    failed_count: int = 0
    rate_limit_count: int = 0
    retry_rate_percent: float = 0.0
    repair_rate_percent: float = 0.0
    provider_stability_percent: float = 100.0
    effective_worker_count: int = 1
    telemetry_reason: str = ""
    progress_percent: float = 0.0
    coverage_ranges: list[CoverageRange] = field(default_factory=list)


@dataclass(frozen=True)
class TranslationJob:
    id: str
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str = "pt-BR"
    mode: str = "balanced"
    strategy: str = "manual"
    status: str = "queued"
    selected_model: str = ""
    provider: str = ""
    worker_count: int = 1
    reuse_existing: bool = True
    max_cost_usd: float | None = None
    stats: TranslationJobStats = field(default_factory=TranslationJobStats)
    error: str = ""
    created_at: str = ""
    updated_at: str = ""
    started_at: str | None = None
    finished_at: str | None = None


def default_jobs_index_path() -> Path:
    raw = os.getenv("OGHMA_TRANSLATION_JOBS_INDEX")
    if raw:
        return Path(raw)
    return Path(get_settings().storage_root) / "translations" / "jobs-index.json"


def create_translation_job(
    *,
    novel_id: str,
    chapter_from: float,
    chapter_to: float,
    selected_model: str,
    provider: str,
    target_language: str = "pt-BR",
    mode: str = "balanced",
    strategy: str = "manual",
    worker_count: int = 1,
    reuse_existing: bool = True,
    max_cost_usd: float | None = None,
    coverage: TranslationCoverage | None = None,
    estimated_cost_usd: float = 0.0,
    estimated_cost_brl: float | None = None,
    path: Path | None = None,
) -> TranslationJob:
    now = datetime.now(timezone.utc).isoformat()
    job = TranslationJob(
        id=str(uuid4()),
        novel_id=novel_id,
        chapter_from=chapter_from,
        chapter_to=chapter_to,
        target_language=target_language,
        mode=mode,
        strategy=strategy,
        status="queued",
        selected_model=selected_model,
        provider=provider,
        worker_count=max(1, worker_count),
        reuse_existing=reuse_existing,
        max_cost_usd=max_cost_usd,
        stats=_initial_stats(
            coverage=coverage,
            estimated_cost_usd=estimated_cost_usd,
            estimated_cost_brl=estimated_cost_brl,
        ),
        created_at=now,
        updated_at=now,
    )
    upsert_translation_job(job, path)
    return job


def load_translation_jobs(path: Path | None = None) -> list[TranslationJob]:
    index_path = path or default_jobs_index_path()
    if not index_path.exists():
        return []
    raw = read_json_index(index_path)
    return _jobs_from_raw(raw)


def save_translation_jobs(jobs: list[TranslationJob], path: Path | None = None) -> None:
    index_path = path or default_jobs_index_path()
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "jobs": [_job_payload(job) for job in sorted(jobs, key=lambda item: item.created_at, reverse=True)],
    }
    write_json_index(index_path, payload)


def upsert_translation_job(job: TranslationJob, path: Path | None = None) -> None:
    index_path = path or default_jobs_index_path()

    def mutate(raw: object) -> object:
        jobs = [item for item in _jobs_from_raw(raw) if item.id != job.id]
        jobs.append(job)
        return _jobs_payload(jobs)

    mutate_json_index(index_path, mutate)


def get_translation_job(job_id: str, path: Path | None = None) -> TranslationJob | None:
    return next((job for job in load_translation_jobs(path) if job.id == job_id), None)


def update_translation_job_status(
    job_id: str,
    status: str,
    *,
    error: str = "",
    path: Path | None = None,
) -> TranslationJob:
    if status not in JOB_STATUSES:
        raise ValueError(f"invalid translation job status: {status}")
    index_path = path or default_jobs_index_path()
    now = datetime.now(timezone.utc).isoformat()
    updated: TranslationJob | None = None

    def mutate(raw: object) -> object:
        nonlocal updated
        updated_jobs: list[TranslationJob] = []
        for job in _jobs_from_raw(raw):
            if job.id != job_id:
                updated_jobs.append(job)
                continue
            payload = asdict(job)
            payload["status"] = status
            payload["error"] = error
            payload["updated_at"] = now
            if status in {"translating", "sampling"} and not job.started_at:
                payload["started_at"] = now
            if status in {"done", "failed", "cancelled"}:
                payload["finished_at"] = now
            updated = _job_from_payload(payload)
            updated_jobs.append(updated)
        if updated is None:
            raise KeyError(job_id)
        return _jobs_payload(updated_jobs)

    mutate_json_index(index_path, mutate)
    if updated is None:
        raise KeyError(job_id)
    return updated


def update_translation_job_stats(
    job_id: str,
    stats: TranslationJobStats,
    *,
    status: str | None = None,
    error: str = "",
    path: Path | None = None,
) -> TranslationJob:
    if status is not None and status not in JOB_STATUSES:
        raise ValueError(f"invalid translation job status: {status}")
    index_path = path or default_jobs_index_path()
    now = datetime.now(timezone.utc).isoformat()
    updated: TranslationJob | None = None

    def mutate(raw: object) -> object:
        nonlocal updated
        updated_jobs: list[TranslationJob] = []
        for job in _jobs_from_raw(raw):
            if job.id != job_id:
                updated_jobs.append(job)
                continue
            payload = asdict(job)
            payload["stats"] = asdict(stats)
            payload["error"] = error
            payload["updated_at"] = now
            if status is not None:
                payload["status"] = status
                if status in {"translating", "sampling"} and not job.started_at:
                    payload["started_at"] = now
                if status in {"done", "failed", "cancelled"}:
                    payload["finished_at"] = now
            updated = _job_from_payload(payload)
            updated_jobs.append(updated)
        if updated is None:
            raise KeyError(job_id)
        return _jobs_payload(updated_jobs)

    mutate_json_index(index_path, mutate)
    if updated is None:
        raise KeyError(job_id)
    return updated


def _jobs_from_raw(raw: object) -> list[TranslationJob]:
    raw_jobs = raw.get("jobs", []) if isinstance(raw, dict) else raw
    if not isinstance(raw_jobs, list):
        raise ValueError("translation jobs index must be a list or an object with jobs[]")
    return [_job_from_payload(item) for item in raw_jobs if isinstance(item, dict)]


def _jobs_payload(jobs: list[TranslationJob]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "jobs": [_job_payload(job) for job in sorted(jobs, key=lambda item: item.created_at, reverse=True)],
    }


def _initial_stats(
    *,
    coverage: TranslationCoverage | None,
    estimated_cost_usd: float,
    estimated_cost_brl: float | None,
) -> TranslationJobStats:
    if coverage is None:
        return TranslationJobStats(
            estimated_cost_usd=estimated_cost_usd,
            estimated_cost_brl=estimated_cost_brl,
        )
    return TranslationJobStats(
        selected_count=coverage.selected_count,
        translated_count=0,
        reusable_count=coverage.translated_count,
        missing_count=coverage.missing_count,
        stale_count=coverage.stale_count,
        unknown_count=coverage.unknown_count,
        estimated_savings_usd=coverage.estimated_savings_usd,
        estimated_savings_brl=coverage.estimated_savings_brl,
        estimated_cost_usd=estimated_cost_usd,
        estimated_cost_brl=estimated_cost_brl,
        coverage_ranges=coverage.ranges,
    )


def _job_from_payload(payload: dict) -> TranslationJob:
    stats_payload = payload.get("stats", {})
    if not isinstance(stats_payload, dict):
        stats_payload = {}
    ranges = [
        CoverageRange(
            start=float(item["start"]),
            end=float(item["end"]),
            count=int(item["count"]),
            freshness=str(item.get("freshness", "fresh")),
        )
        for item in stats_payload.get("coverage_ranges", [])
        if isinstance(item, dict)
    ]
    stats = TranslationJobStats(
        selected_count=int(stats_payload.get("selected_count", 0)),
        translated_count=int(stats_payload.get("translated_count", 0)),
        reusable_count=int(stats_payload.get("reusable_count", 0)),
        missing_count=int(stats_payload.get("missing_count", 0)),
        stale_count=int(stats_payload.get("stale_count", 0)),
        unknown_count=int(stats_payload.get("unknown_count", 0)),
        estimated_savings_usd=float(stats_payload.get("estimated_savings_usd", 0.0)),
        estimated_savings_brl=_optional_float(stats_payload.get("estimated_savings_brl")),
        estimated_cost_usd=float(stats_payload.get("estimated_cost_usd", 0.0)),
        estimated_cost_brl=_optional_float(stats_payload.get("estimated_cost_brl")),
        actual_cost_usd=float(stats_payload.get("actual_cost_usd", 0.0)),
        actual_cost_brl=_optional_float(stats_payload.get("actual_cost_brl")),
        estimated_remaining_cost_usd=float(stats_payload.get("estimated_remaining_cost_usd", 0.0)),
        estimated_remaining_cost_brl=_optional_float(stats_payload.get("estimated_remaining_cost_brl")),
        average_cost_usd_per_chapter=float(stats_payload.get("average_cost_usd_per_chapter", 0.0)),
        average_input_tokens_per_chapter=float(stats_payload.get("average_input_tokens_per_chapter", 0.0)),
        average_output_tokens_per_chapter=float(stats_payload.get("average_output_tokens_per_chapter", 0.0)),
        output_input_ratio=float(stats_payload.get("output_input_ratio", 0.0)),
        average_seconds_per_chapter=float(stats_payload.get("average_seconds_per_chapter", 0.0)),
        cost_per_minute_usd=float(stats_payload.get("cost_per_minute_usd", 0.0)),
        elapsed_seconds=float(stats_payload.get("elapsed_seconds", 0.0)),
        eta_seconds=_optional_float(stats_payload.get("eta_seconds")),
        retry_count=int(stats_payload.get("retry_count", 0)),
        repair_count=int(stats_payload.get("repair_count", 0)),
        failed_count=int(stats_payload.get("failed_count", 0)),
        rate_limit_count=int(stats_payload.get("rate_limit_count", 0)),
        retry_rate_percent=float(stats_payload.get("retry_rate_percent", 0.0)),
        repair_rate_percent=float(stats_payload.get("repair_rate_percent", 0.0)),
        provider_stability_percent=float(stats_payload.get("provider_stability_percent", 100.0)),
        effective_worker_count=int(stats_payload.get("effective_worker_count", 1)),
        telemetry_reason=str(stats_payload.get("telemetry_reason", "")),
        progress_percent=float(stats_payload.get("progress_percent", 0.0)),
        coverage_ranges=ranges,
    )
    return TranslationJob(
        id=str(payload["id"]),
        novel_id=str(payload["novel_id"]),
        chapter_from=float(payload["chapter_from"]),
        chapter_to=float(payload["chapter_to"]),
        target_language=str(payload.get("target_language", "pt-BR")),
        mode=str(payload.get("mode", "balanced")),
        strategy=str(payload.get("strategy", "manual")),
        status=str(payload.get("status", "queued")),
        selected_model=str(payload.get("selected_model", "")),
        provider=str(payload.get("provider", "")),
        worker_count=int(payload.get("worker_count", 1)),
        reuse_existing=bool(payload.get("reuse_existing", True)),
        max_cost_usd=_optional_float(payload.get("max_cost_usd")),
        stats=stats,
        error=str(payload.get("error", "")),
        created_at=str(payload.get("created_at", "")),
        updated_at=str(payload.get("updated_at", "")),
        started_at=payload.get("started_at"),
        finished_at=payload.get("finished_at"),
    )


def translation_job_from_payload(payload: dict) -> TranslationJob:
    return _job_from_payload(payload)


def _job_payload(job: TranslationJob) -> dict[str, object]:
    return {
        "id": job.id,
        "novel_id": job.novel_id,
        "chapter_from": job.chapter_from,
        "chapter_to": job.chapter_to,
        "target_language": job.target_language,
        "mode": job.mode,
        "strategy": job.strategy,
        "status": job.status,
        "selected_model": job.selected_model,
        "provider": job.provider,
        "worker_count": job.worker_count,
        "reuse_existing": job.reuse_existing,
        "max_cost_usd": job.max_cost_usd,
        "stats": {
            **asdict(job.stats),
            "coverage_ranges": [asdict(item) for item in job.stats.coverage_ranges],
        },
        "error": job.error,
        "created_at": job.created_at,
        "updated_at": job.updated_at,
        "started_at": job.started_at,
        "finished_at": job.finished_at,
    }


def translation_job_payload(job: TranslationJob) -> dict[str, object]:
    return _job_payload(job)


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)
