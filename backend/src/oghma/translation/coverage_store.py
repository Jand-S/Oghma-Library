"""Database-backed translated chapter coverage storage."""
from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TranslationChapterRow
from .coverage import TranslationChapterRecord, translation_chapter_record_from_payload, translation_chapter_record_payload


async def upsert_coverage_row(session: AsyncSession, record: TranslationChapterRecord) -> TranslationChapterRecord:
    updated = record
    if not updated.updated_at:
        updated = TranslationChapterRecord(**{**asdict(updated), "updated_at": datetime.now(timezone.utc).isoformat()})
    row_id = _row_id(updated)
    row = await session.get(TranslationChapterRow, row_id)
    if row is None:
        row = TranslationChapterRow(id=row_id)
        session.add(row)
    _apply_record_to_row(row, updated)
    await session.flush()
    return updated


async def upsert_coverage_rows(session: AsyncSession, records: list[TranslationChapterRecord]) -> list[TranslationChapterRecord]:
    updated: list[TranslationChapterRecord] = []
    for record in records:
        updated.append(await upsert_coverage_row(session, record))
    return updated


async def load_coverage_rows(
    session: AsyncSession,
    *,
    novel_id: str | None = None,
    target_language: str | None = None,
) -> list[TranslationChapterRecord]:
    stmt = select(TranslationChapterRow)
    if novel_id:
        stmt = stmt.where(TranslationChapterRow.novel_id == novel_id)
    if target_language:
        stmt = stmt.where(TranslationChapterRow.target_language == target_language)
    rows = (await session.scalars(stmt.order_by(TranslationChapterRow.novel_id, TranslationChapterRow.chapter_number))).all()
    return [_record_from_row(row) for row in rows]


def merge_coverage_records(
    left: list[TranslationChapterRecord],
    right: list[TranslationChapterRecord],
) -> list[TranslationChapterRecord]:
    merged = {_record_key(record): record for record in left}
    for record in right:
        current = merged.get(_record_key(record))
        if current is None or (record.updated_at or "") >= (current.updated_at or ""):
            merged[_record_key(record)] = record
    return sorted(merged.values(), key=lambda item: (item.novel_id, item.target_language, item.chapter_number))


def _apply_record_to_row(row: TranslationChapterRow, record: TranslationChapterRecord) -> None:
    payload = translation_chapter_record_payload(record)
    row.novel_id = str(payload["novel_id"])
    row.chapter_id = str(payload.get("chapter_id", ""))
    row.chapter_number = float(payload["chapter_number"])
    row.target_language = str(payload.get("target_language", "pt-BR"))
    row.status = str(payload.get("status", "approved_auto"))
    row.translated_path = str(payload.get("translated_path", ""))
    row.sidecar_path = str(payload.get("sidecar_path", ""))
    row.source_hash = str(payload["source_hash"]) if payload.get("source_hash") else None
    row.translated_hash = str(payload["translated_hash"]) if payload.get("translated_hash") else None
    row.model = str(payload.get("model", ""))
    row.provider = str(payload.get("provider", ""))
    row.quality_score = _optional_float(payload.get("quality_score"))
    row.public_reusable = bool(payload.get("public_reusable", True))
    row.origin = str(payload.get("origin", "local"))
    row.updated_at = _parse_datetime(payload.get("updated_at")) or datetime.now(timezone.utc)


def _record_from_row(row: TranslationChapterRow) -> TranslationChapterRecord:
    return translation_chapter_record_from_payload(
        {
            "novel_id": row.novel_id,
            "chapter_id": row.chapter_id,
            "chapter_number": float(row.chapter_number),
            "target_language": row.target_language,
            "status": row.status,
            "translated_path": row.translated_path,
            "sidecar_path": row.sidecar_path,
            "source_hash": row.source_hash,
            "translated_hash": row.translated_hash,
            "model": row.model,
            "provider": row.provider,
            "quality_score": row.quality_score,
            "public_reusable": row.public_reusable,
            "origin": row.origin,
            "updated_at": _format_datetime(row.updated_at),
        }
    )


def _row_id(record: TranslationChapterRecord) -> str:
    return f"{record.novel_id}:{record.target_language}:{record.chapter_number:g}"


def _record_key(record: TranslationChapterRecord) -> tuple[str, str, float]:
    return (record.novel_id, record.target_language, record.chapter_number)


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

