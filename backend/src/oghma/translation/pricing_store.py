"""Database-backed translation pricing snapshots."""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import TranslationPricingSnapshotRow
from .pricing import PricingSnapshot


async def upsert_pricing_snapshot(
    session: AsyncSession,
    snapshot: PricingSnapshot,
) -> PricingSnapshot:
    row_id = pricing_snapshot_id(snapshot.provider, snapshot.model)
    row = await session.get(TranslationPricingSnapshotRow, row_id)
    if row is None:
        row = TranslationPricingSnapshotRow(id=row_id)
        session.add(row)
    _apply_snapshot_to_row(row, snapshot)
    await session.flush()
    return snapshot


async def upsert_pricing_snapshots(
    session: AsyncSession,
    snapshots: list[PricingSnapshot],
) -> list[PricingSnapshot]:
    for snapshot in snapshots:
        await upsert_pricing_snapshot(session, snapshot)
    return snapshots


async def load_pricing_snapshot_rows(
    session: AsyncSession,
    *,
    provider: str | None = None,
    model: str | None = None,
    limit: int = 1000,
) -> list[PricingSnapshot]:
    stmt = select(TranslationPricingSnapshotRow)
    if provider:
        stmt = stmt.where(TranslationPricingSnapshotRow.provider == provider)
    if model:
        stmt = stmt.where(TranslationPricingSnapshotRow.model == model)
    rows = (
        await session.scalars(
            stmt.order_by(TranslationPricingSnapshotRow.fetched_at.desc()).limit(limit)
        )
    ).all()
    return [_snapshot_from_row(row) for row in rows]


def merge_pricing_snapshots(
    database: list[PricingSnapshot],
    fallback: list[PricingSnapshot],
) -> list[PricingSnapshot]:
    """Merge snapshots, preferring the newest copy of each provider/model."""
    merged = {(item.provider, item.model): item for item in fallback}
    for item in database:
        key = (item.provider, item.model)
        current = merged.get(key)
        if current is None or _timestamp(item.fetched_at) >= _timestamp(current.fetched_at):
            merged[key] = item
    return sorted(merged.values(), key=lambda item: _timestamp(item.fetched_at), reverse=True)


def pricing_snapshot_id(provider: str, model: str) -> str:
    return f"{provider}:{model}"


def _apply_snapshot_to_row(
    row: TranslationPricingSnapshotRow,
    snapshot: PricingSnapshot,
) -> None:
    row.provider = snapshot.provider
    row.model = snapshot.model
    row.input_usd_per_1m = snapshot.input_usd_per_1m
    row.cached_input_usd_per_1m = snapshot.cached_input_usd_per_1m
    row.output_usd_per_1m = snapshot.output_usd_per_1m
    row.source_url = snapshot.source_url
    row.fetched_at = _parse_datetime(snapshot.fetched_at)
    row.expires_at = _parse_datetime(snapshot.expires_at)


def _snapshot_from_row(row: TranslationPricingSnapshotRow) -> PricingSnapshot:
    return PricingSnapshot(
        provider=row.provider,
        model=row.model,
        input_usd_per_1m=row.input_usd_per_1m,
        cached_input_usd_per_1m=row.cached_input_usd_per_1m,
        output_usd_per_1m=row.output_usd_per_1m,
        source_url=row.source_url or "",
        fetched_at=_format_datetime(row.fetched_at),
        expires_at=_format_datetime(row.expires_at),
    )


def _parse_datetime(value: str | datetime) -> datetime:
    parsed = value if isinstance(value, datetime) else datetime.fromisoformat(value)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _format_datetime(value: datetime) -> str:
    return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()


def _timestamp(value: str) -> float:
    try:
        return _parse_datetime(value).timestamp()
    except (TypeError, ValueError):
        return 0.0
