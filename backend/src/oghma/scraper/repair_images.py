"""Repair existing chapters whose inline images still point to external sites."""
from __future__ import annotations

import asyncio
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import httpx
from sqlalchemy import select

from .. import storage
from ..config import get_settings
from ..db import SessionLocal
from ..models import Chapter, Novel
from . import registry
from .chapter_assets import external_image_urls, localize_chapter_images
from .base import RawPage


class _RepairImageFetcher:
    """Short, bounded retries for a one-off pass over historical assets."""

    def __init__(self, referer: str) -> None:
        self._client = httpx.AsyncClient(
            follow_redirects=True,
            timeout=15,
            headers={
                "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
                "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8,*/*;q=0.5",
                "Referer": referer,
            },
            transport=httpx.AsyncHTTPTransport(retries=1),
        )

    async def get(self, url: str) -> RawPage:
        response = await self._client.get(url)
        response.raise_for_status()
        return RawPage(
            url=str(response.url),
            html=response.content,
            content_type=response.headers.get("Content-Type"),
        )

    async def aclose(self) -> None:
        await self._client.aclose()


async def repair_chapter_images(
    source_id: str = "all",
    *,
    limit: int | None = None,
    dry_run: bool = False,
    image_rate_seconds: float = 0.1,
) -> dict:
    source_ids = sorted(connector.id for connector in registry.all_connectors()) if source_id == "all" else [source_id]
    report: dict = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "dry_run": dry_run,
        "sources": {},
    }

    async with SessionLocal() as session:
        for current_source in source_ids:
            connector = registry.get(current_source)
            fetcher = _RepairImageFetcher(connector.base_url)
            source_stats = {
                "novels": {},
                "chapters_scanned": 0,
                "chapters_affected": 0,
                "image_references": 0,
                "downloaded": 0,
                "reused": 0,
                "removed": 0,
                "failed": 0,
                "failed_urls": [],
            }
            try:
                stmt = (
                    select(Chapter, Novel.slug, Novel.title)
                    .join(Novel, Chapter.novel_id == Novel.id)
                    .where(Novel.source_id == current_source, Chapter.content_path.is_not(None))
                    .order_by(Novel.title, Chapter.number)
                )
                if limit:
                    stmt = stmt.limit(limit)
                rows = (await session.execute(stmt)).all()
                affected = []
                for chapter, slug, title in rows:
                    source_stats["chapters_scanned"] += 1
                    path = Path(chapter.content_path or "")
                    try:
                        html = path.read_text(encoding="utf-8")
                    except OSError as exc:
                        source_stats["failed"] += 1
                        source_stats["failed_urls"].append(f"{chapter.id}: {exc}")
                        continue
                    urls = external_image_urls(html, chapter.source_url)
                    if not urls:
                        continue
                    source_stats["chapters_affected"] += 1
                    source_stats["image_references"] += len(urls)
                    novel = source_stats["novels"].setdefault(
                        chapter.novel_id,
                        {
                            "title": title,
                            "chapters": 0,
                            "image_references": 0,
                            "downloaded": 0,
                            "reused": 0,
                            "removed": 0,
                            "failed": 0,
                        },
                    )
                    novel["chapters"] += 1
                    novel["image_references"] += len(urls)
                    if dry_run:
                        continue
                    affected.append((chapter, slug, path, html, novel))
                if not dry_run:
                    semaphore = asyncio.Semaphore(8)

                    async def process(item):
                        chapter, slug, path, html, novel = item
                        async with semaphore:
                            localized = await localize_chapter_images(
                                fetcher,
                                html,
                                chapter.source_url,
                                current_source,
                                slug,
                                remove_unavailable=True,
                            )
                        return item, localized

                    for offset in range(0, len(affected), 50):
                        batch = affected[offset:offset + 50]
                        results = await asyncio.gather(*(process(item) for item in batch))
                        for item, localized in results:
                            chapter, slug, path, html, novel = item
                            for key in ("downloaded", "reused", "removed", "failed"):
                                value = getattr(localized, key)
                                source_stats[key] += value
                                novel[key] += value
                            if localized.failed:
                                remaining = external_image_urls(localized.html, chapter.source_url)
                                source_stats["failed_urls"].extend(f"{chapter.id}: {url}" for url in remaining)
                            if localized.html != html:
                                path.write_text(localized.html, encoding="utf-8")
                                chapter.content_hash = storage.sha256(localized.html)
                        await session.commit()
                        print(
                            f"repair-images source={current_source} "
                            f"chapters={min(offset + len(batch), len(affected))}/{len(affected)} "
                            f"downloaded={source_stats['downloaded']} reused={source_stats['reused']} "
                            f"removed={source_stats['removed']} failed={source_stats['failed']}",
                            flush=True,
                        )
                if not dry_run:
                    await session.commit()
            finally:
                await fetcher.aclose()
            report["sources"][current_source] = source_stats

    report["finished_at"] = datetime.now(timezone.utc).isoformat()
    report_path = _write_report(report)
    report["report_path"] = str(report_path)
    return report


def _write_report(report: dict) -> Path:
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    root = Path(get_settings().storage_root) / "reports"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"chapter-images-{timestamp}.md"
    lines = [
        "# Chapter image repair report",
        "",
        f"Started: {report['started_at']}",
        f"Finished: {report.get('finished_at', '-')}",
        f"Dry run: {report['dry_run']}",
        "",
    ]
    for source_id, stats in report["sources"].items():
        lines.extend(
            [
                f"## {source_id}",
                "",
                f"- Novels affected: {len(stats['novels'])}",
                f"- Chapters scanned: {stats['chapters_scanned']}",
                f"- Chapters affected: {stats['chapters_affected']}",
                f"- Image references: {stats['image_references']}",
                f"- Images downloaded: {stats['downloaded']}",
                f"- Images reused: {stats['reused']}",
                f"- Broken images removed: {stats['removed']}",
                f"- Failures: {stats['failed']}",
                "",
                "### Novels",
                "",
            ]
        )
        for novel_id, novel in sorted(stats["novels"].items(), key=lambda item: item[1]["title"].lower()):
            lines.append(
                f"- {novel['title']} (`{novel_id}`): {novel['chapters']} chapters, "
                f"{novel['image_references']} references, {novel['downloaded']} downloaded, "
                f"{novel['reused']} reused, {novel['removed']} removed, {novel['failed']} failures"
            )
        if stats["failed_urls"]:
            lines.extend(["", "### Failures", ""])
            lines.extend(f"- {failure}" for failure in stats["failed_urls"])
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path
