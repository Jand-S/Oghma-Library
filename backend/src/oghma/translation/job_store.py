"""Database-backed translation job storage.

The JSON registry remains available as a local fallback while the API moves to
database-first persistence.
"""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TranslationJobRow
from .jobs import JOB_STATUSES, TranslationJob, TranslationJobStats, translation_job_from_payload, translation_job_payload


async def upsert_job_row(session: AsyncSession, job: TranslationJob) -> TranslationJob:
    row = await session.get(TranslationJobRow, job.id)
    payload = translation_job_payload(job)
    if row is None:
        row = TranslationJobRow(id=job.id)
        session.add(row)
    _apply_payload_to_row(row, payload)
    await session.flush()
    return job


async def get_job_row(session: AsyncSession, job_id: str) -> TranslationJob | None:
    row = await session.get(TranslationJobRow, job_id)
    return _job_from_row(row) if row else None


async def list_job_rows(session: AsyncSession, *, limit: int = 100) -> list[TranslationJob]:
    rows = (
        await session.scalars(
            select(TranslationJobRow)
            .order_by(TranslationJobRow.created_at.desc())
            .limit(limit)
        )
    ).all()
    return [_job_from_row(row) for row in rows]


async def update_job_row_status(
    session: AsyncSession,
    job_id: str,
    status: str,
    *,
    error: str = "",
) -> TranslationJob:
    if status not in JOB_STATUSES:
        raise ValueError(f"invalid translation job status: {status}")
    job = await get_job_row(session, job_id)
    if job is None:
        raise KeyError(job_id)
    payload = translation_job_payload(job)
    now = datetime.now(timezone.utc).isoformat()
    payload["status"] = status
    payload["error"] = error
    payload["updated_at"] = now
    if status in {"translating", "sampling"} and not job.started_at:
        payload["started_at"] = now
    if status in {"done", "failed", "cancelled"}:
        payload["finished_at"] = now
    updated = translation_job_from_payload(payload)
    await upsert_job_row(session, updated)
    return updated


async def update_job_row_stats(
    session: AsyncSession,
    job_id: str,
    stats: TranslationJobStats,
    *,
    status: str | None = None,
    error: str = "",
) -> TranslationJob:
    if status is not None and status not in JOB_STATUSES:
        raise ValueError(f"invalid translation job status: {status}")
    job = await get_job_row(session, job_id)
    if job is None:
        raise KeyError(job_id)
    payload = translation_job_payload(job)
    now = datetime.now(timezone.utc).isoformat()
    payload["stats"] = asdict(stats)
    payload["error"] = error
    payload["updated_at"] = now
    if status is not None:
        payload["status"] = status
        if status in {"translating", "sampling"} and not job.started_at:
            payload["started_at"] = now
        if status in {"done", "failed", "cancelled"}:
            payload["finished_at"] = now
    updated = translation_job_from_payload(payload)
    await upsert_job_row(session, updated)
    return updated


def _apply_payload_to_row(row: TranslationJobRow, payload: dict[str, object]) -> None:
    row.novel_id = str(payload["novel_id"])
    row.chapter_from = float(payload["chapter_from"])
    row.chapter_to = float(payload["chapter_to"])
    row.target_language = str(payload.get("target_language", "pt-BR"))
    row.mode = str(payload.get("mode", "balanced"))
    row.strategy = str(payload.get("strategy", "manual"))
    row.status = str(payload.get("status", "queued"))
    row.selected_model = str(payload.get("selected_model", ""))
    row.provider = str(payload.get("provider", ""))
    row.worker_count = int(payload.get("worker_count", 1))
    row.reuse_existing = bool(payload.get("reuse_existing", True))
    row.max_cost_usd = _optional_float(payload.get("max_cost_usd"))
    row.stats = payload.get("stats", {}) if isinstance(payload.get("stats"), dict) else {}
    row.error = str(payload.get("error", ""))
    row.created_at = _parse_datetime(payload.get("created_at")) or datetime.now(timezone.utc)
    row.updated_at = _parse_datetime(payload.get("updated_at")) or datetime.now(timezone.utc)
    row.started_at = _parse_datetime(payload.get("started_at"))
    row.finished_at = _parse_datetime(payload.get("finished_at"))


def _job_from_row(row: TranslationJobRow) -> TranslationJob:
    return translation_job_from_payload(
        {
            "id": row.id,
            "novel_id": row.novel_id,
            "chapter_from": float(row.chapter_from),
            "chapter_to": float(row.chapter_to),
            "target_language": row.target_language,
            "mode": row.mode,
            "strategy": row.strategy,
            "status": row.status,
            "selected_model": row.selected_model,
            "provider": row.provider,
            "worker_count": row.worker_count,
            "reuse_existing": row.reuse_existing,
            "max_cost_usd": row.max_cost_usd,
            "stats": row.stats or {},
            "error": row.error or "",
            "created_at": _format_datetime(row.created_at),
            "updated_at": _format_datetime(row.updated_at),
            "started_at": _format_datetime(row.started_at) if row.started_at else None,
            "finished_at": _format_datetime(row.finished_at) if row.finished_at else None,
        }
    )


def _parse_datetime(value: object) -> datetime | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(str(value))


def _format_datetime(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.isoformat()


def _optional_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)

