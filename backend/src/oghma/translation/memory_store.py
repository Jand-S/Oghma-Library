"""Database-backed translation memory storage."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TranslationMemoryTermRow
from .memory import TranslationMemoryTerm, translation_memory_term_from_payload, translation_memory_term_payload


async def upsert_memory_term_row(session: AsyncSession, term: TranslationMemoryTerm) -> TranslationMemoryTerm:
    updated = term
    if not updated.updated_at:
        updated = TranslationMemoryTerm(**{**asdict(updated), "updated_at": datetime.now(timezone.utc).isoformat()})
    row_id = _row_id(updated.novel_id, updated.source)
    row = await session.get(TranslationMemoryTermRow, row_id)
    if row is not None:
        updated = _merge_term(_term_from_row(row), updated)
    else:
        row = TranslationMemoryTermRow(id=row_id)
        session.add(row)
    _apply_term_to_row(row, updated)
    await session.flush()
    return updated


async def upsert_memory_term_rows(session: AsyncSession, terms: list[TranslationMemoryTerm]) -> list[TranslationMemoryTerm]:
    updated: list[TranslationMemoryTerm] = []
    for term in terms:
        updated.append(await upsert_memory_term_row(session, term))
    return updated


async def load_memory_term_rows(
    session: AsyncSession,
    *,
    novel_id: str | None = None,
    status: str | None = None,
) -> list[TranslationMemoryTerm]:
    stmt = select(TranslationMemoryTermRow)
    if novel_id:
        stmt = stmt.where(TranslationMemoryTermRow.novel_id == novel_id)
    if status:
        stmt = stmt.where(TranslationMemoryTermRow.status == status)
    rows = (await session.scalars(stmt.order_by(TranslationMemoryTermRow.novel_id, TranslationMemoryTermRow.source))).all()
    return [_term_from_row(row) for row in rows]


def merge_memory_terms(left: list[TranslationMemoryTerm], right: list[TranslationMemoryTerm]) -> list[TranslationMemoryTerm]:
    merged = {(term.novel_id, term.source.lower()): term for term in left}
    for term in right:
        key = (term.novel_id, term.source.lower())
        current = merged.get(key)
        merged[key] = _merge_term(current, term) if current else term
    return sorted(merged.values(), key=lambda item: (item.novel_id, item.source.lower()))


def _apply_term_to_row(row: TranslationMemoryTermRow, term: TranslationMemoryTerm) -> None:
    payload = translation_memory_term_payload(term)
    row.novel_id = str(payload["novel_id"])
    row.source = str(payload["source"])
    row.target = str(payload.get("target", payload["source"]))
    row.status = str(payload.get("status", "candidate"))
    row.category = str(payload.get("category", ""))
    row.occurrences = int(payload.get("occurrences", 0))
    row.first_chapter = _optional_float(payload.get("first_chapter"))
    row.last_chapter = _optional_float(payload.get("last_chapter"))
    row.confidence = float(payload.get("confidence", 0.0))
    row.notes = str(payload.get("notes", ""))
    row.updated_at = _parse_datetime(payload.get("updated_at")) or datetime.now(timezone.utc)


def _term_from_row(row: TranslationMemoryTermRow) -> TranslationMemoryTerm:
    return translation_memory_term_from_payload(
        {
            "novel_id": row.novel_id,
            "source": row.source,
            "target": row.target,
            "status": row.status,
            "category": row.category,
            "occurrences": row.occurrences,
            "first_chapter": float(row.first_chapter) if row.first_chapter is not None else None,
            "last_chapter": float(row.last_chapter) if row.last_chapter is not None else None,
            "confidence": row.confidence,
            "notes": row.notes,
            "updated_at": _format_datetime(row.updated_at),
        }
    )


def _merge_term(current: TranslationMemoryTerm | None, new: TranslationMemoryTerm) -> TranslationMemoryTerm:
    if current is None:
        return new
    status_rank = {"candidate": 0, "approved_auto": 1, "approved": 2, "locked_auto": 3, "locked": 4}
    current_rank = status_rank.get(current.status, 0)
    new_rank = status_rank.get(new.status, 0)
    winner = current if current_rank >= new_rank else new
    return TranslationMemoryTerm(
        novel_id=current.novel_id,
        source=current.source,
        target=winner.target,
        status=winner.status,
        category=current.category or new.category,
        occurrences=current.occurrences + new.occurrences,
        first_chapter=_min_optional(current.first_chapter, new.first_chapter),
        last_chapter=_max_optional(current.last_chapter, new.last_chapter),
        confidence=max(current.confidence, new.confidence),
        notes=current.notes or new.notes,
        updated_at=new.updated_at or current.updated_at,
    )


def _row_id(novel_id: str, source: str) -> str:
    return f"{novel_id}:{source.lower()}"


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


def _min_optional(left: float | None, right: float | None) -> float | None:
    values = [item for item in (left, right) if item is not None]
    return min(values) if values else None


def _max_optional(left: float | None, right: float | None) -> float | None:
    values = [item for item in (left, right) if item is not None]
    return max(values) if values else None

