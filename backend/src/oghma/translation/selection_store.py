"""Database-backed automatic model selection history."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TranslationSelectionHistoryRow
from .selection_history import (
    AutomaticSelectionRecord,
    automatic_selection_record_from_payload,
    automatic_selection_record_payload,
)


async def upsert_selection_row(session: AsyncSession, record: AutomaticSelectionRecord) -> AutomaticSelectionRecord:
    row = await session.get(TranslationSelectionHistoryRow, record.id)
    if row is None:
        row = TranslationSelectionHistoryRow(id=record.id)
        session.add(row)
    _apply_record_to_row(row, record)
    await session.flush()
    return record


async def upsert_selection_rows(
    session: AsyncSession,
    records: list[AutomaticSelectionRecord],
) -> list[AutomaticSelectionRecord]:
    for record in records:
        await upsert_selection_row(session, record)
    return records


async def load_selection_rows(
    session: AsyncSession,
    *,
    novel_id: str | None = None,
    target_language: str | None = None,
    limit: int = 100,
) -> list[AutomaticSelectionRecord]:
    stmt = select(TranslationSelectionHistoryRow)
    if novel_id:
        stmt = stmt.where(TranslationSelectionHistoryRow.novel_id == novel_id)
    if target_language:
        stmt = stmt.where(TranslationSelectionHistoryRow.target_language == target_language)
    rows = (
        await session.scalars(
            stmt.order_by(TranslationSelectionHistoryRow.created_at.desc()).limit(limit)
        )
    ).all()
    return [_record_from_row(row) for row in rows]


def merge_selection_records(
    left: list[AutomaticSelectionRecord],
    right: list[AutomaticSelectionRecord],
) -> list[AutomaticSelectionRecord]:
    merged = {record.id: record for record in left}
    for record in right:
        current = merged.get(record.id)
        if current is None or (record.created_at or "") >= (current.created_at or ""):
            merged[record.id] = record
    return sorted(merged.values(), key=lambda item: item.created_at, reverse=True)


def _apply_record_to_row(row: TranslationSelectionHistoryRow, record: AutomaticSelectionRecord) -> None:
    payload = automatic_selection_record_payload(record)
    row.job_id = str(payload["job_id"])
    row.novel_id = str(payload["novel_id"])
    row.chapter_from = float(payload["chapter_from"])
    row.chapter_to = float(payload["chapter_to"])
    row.target_language = str(payload.get("target_language", "pt-BR"))
    row.mode = str(payload.get("mode", "balanced"))
    row.winner_model = str(payload["winner_model"])
    row.winner_provider = str(payload.get("winner_provider", ""))
    row.editorial_grade_count = int(payload.get("editorial_grade_count", 0))
    row.editorial_cost_usd = float(payload.get("editorial_cost_usd", 0.0))
    row.sample_chapters = list(payload.get("sample_chapters", []))
    row.trials = list(payload.get("trials", []))
    row.created_at = _parse_datetime(payload.get("created_at")) or datetime.now(timezone.utc)


def _record_from_row(row: TranslationSelectionHistoryRow) -> AutomaticSelectionRecord:
    return automatic_selection_record_from_payload(
        {
            "id": row.id,
            "job_id": row.job_id,
            "novel_id": row.novel_id,
            "chapter_from": float(row.chapter_from),
            "chapter_to": float(row.chapter_to),
            "target_language": row.target_language,
            "mode": row.mode,
            "winner_model": row.winner_model,
            "winner_provider": row.winner_provider,
            "editorial_grade_count": row.editorial_grade_count,
            "editorial_cost_usd": row.editorial_cost_usd,
            "sample_chapters": row.sample_chapters or [],
            "trials": row.trials or [],
            "created_at": _format_datetime(row.created_at),
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

