"""Unit tests for crawler orchestration policies."""
from datetime import datetime, timedelta, timezone

from oghma.models import Novel
from oghma.scraper.base import NovelMeta
from oghma.scraper.orchestrator import _cover_needs_refresh


def _novel(cover_path: str, *, cover_url: str, checked_at: datetime) -> Novel:
    return Novel(
        id="source:novel",
        source_id="source",
        slug="novel",
        title="Novel",
        source_url="https://example.test/novel",
        cover_url=cover_url,
        cover_path=cover_path,
        language="en",
        status="ongoing",
        tags=[],
        extra={"cover_checked_at": checked_at.isoformat()},
    )


def test_cover_is_rechecked_only_after_six_months(tmp_path):
    now = datetime(2026, 6, 19, tzinfo=timezone.utc)
    cover = tmp_path / "cover.webp"
    cover.write_bytes(b"cover")
    url = "https://cdn.example.test/cover.webp"
    meta = NovelMeta("source", "novel", "Novel", "https://example.test/novel", cover_url=url)

    recent = _novel(str(cover), cover_url=url, checked_at=now - timedelta(days=179))
    stale = _novel(str(cover), cover_url=url, checked_at=now - timedelta(days=181))

    assert not _cover_needs_refresh(recent, meta, now=now)
    assert _cover_needs_refresh(stale, meta, now=now)


def test_cover_is_rechecked_when_source_url_changes(tmp_path):
    now = datetime(2026, 6, 19, tzinfo=timezone.utc)
    cover = tmp_path / "cover.webp"
    cover.write_bytes(b"cover")
    novel = _novel(
        str(cover),
        cover_url="https://cdn.example.test/old.webp",
        checked_at=now,
    )
    meta = NovelMeta(
        "source",
        "novel",
        "Novel",
        "https://example.test/novel",
        cover_url="https://cdn.example.test/new.webp",
    )

    assert _cover_needs_refresh(novel, meta, now=now)
