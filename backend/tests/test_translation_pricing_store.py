from datetime import datetime, timedelta, timezone

from oghma.models import TranslationPricingSnapshotRow
from oghma.translation.pricing import PricingSnapshot
from oghma.translation.pricing_store import (
    _apply_snapshot_to_row,
    _snapshot_from_row,
    merge_pricing_snapshots,
    pricing_snapshot_id,
)


def _snapshot(*, fetched_at: datetime, input_price: float = 1.0) -> PricingSnapshot:
    return PricingSnapshot(
        provider="openrouter",
        model="test/model",
        input_usd_per_1m=input_price,
        cached_input_usd_per_1m=0.5,
        output_usd_per_1m=2.0,
        source_url="https://example.test/models",
        fetched_at=fetched_at.isoformat(),
        expires_at=(fetched_at + timedelta(days=1)).isoformat(),
    )


def test_pricing_snapshot_row_mapping_preserves_catalog_values():
    snapshot = _snapshot(fetched_at=datetime.now(timezone.utc))
    row = TranslationPricingSnapshotRow(
        id=pricing_snapshot_id(snapshot.provider, snapshot.model)
    )

    _apply_snapshot_to_row(row, snapshot)
    restored = _snapshot_from_row(row)

    assert restored == snapshot


def test_merge_pricing_snapshots_prefers_newest_copy():
    old = _snapshot(
        fetched_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        input_price=1.0,
    )
    new = _snapshot(
        fetched_at=datetime(2026, 1, 2, tzinfo=timezone.utc),
        input_price=0.75,
    )

    assert merge_pricing_snapshots([new], [old])[0].input_usd_per_1m == 0.75
    assert merge_pricing_snapshots([old], [new])[0].input_usd_per_1m == 0.75
