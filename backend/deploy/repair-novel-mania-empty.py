"""Audit or repair empty chapters of one Novel Mania novel, with backups.

Run inside the backend runtime. No B2 publication is performed by this script.
"""
from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

from selectolax.parser import HTMLParser
from sqlalchemy import select

from oghma import storage
from oghma.config import get_settings
from oghma.db import SessionLocal
from oghma.models import Chapter, CrawlRun, Novel
from oghma.scraper.connectors.novel_mania import NovelManiaConnector
from oghma.scraper.chapter_assets import localize_chapter_images
from oghma.scraper.fetcher import HttpFetcher


async def run(slug: str, apply: bool, progress=None) -> dict:
    novel_id = f"novel-mania:{slug}"
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    report_dir = Path(get_settings().storage_root) / "reports" / f"repair-empty-{slug}-{stamp}"
    report_dir.mkdir(parents=True, exist_ok=True)
    report = {"novel_id": novel_id, "apply": apply, "chapters": [], "repaired": 0, "failed": 0}
    fetcher = HttpFetcher(rate_limit_seconds=4)
    connector = NovelManiaConnector()
    try:
        async with SessionLocal() as session:
            novel = await session.get(Novel, novel_id)
            if novel is None:
                raise ValueError(f"Novel not found: {novel_id}")
            chapters = (await session.scalars(select(Chapter).where(
                Chapter.novel_id == novel_id,
            ).order_by(Chapter.number))).all()
            for chapter in chapters:
                path = Path(chapter.content_path) if chapter.content_path else None
                html = path.read_text(encoding="utf-8") if path and path.is_file() else ""
                tree = HTMLParser(html)
                if tree.text(strip=True) or tree.css_first("img[src]") is not None:
                    continue
                item = {"number": float(chapter.number), "title": chapter.title,
                        "source_url": chapter.source_url, "status": "empty"}
                report["chapters"].append(item)
                if progress:
                    await progress(item)
                if not apply:
                    continue
                backup = report_dir / f"chapter-{chapter.number}"
                backup.mkdir()
                old = {column.name: getattr(chapter, column.name) for column in Chapter.__table__.columns}
                (backup / "record.json").write_text(json.dumps(old, default=str, indent=2), encoding="utf-8")
                for label, source in (("raw.html.gz", chapter.raw_path), ("content.html", chapter.content_path)):
                    if source and Path(source).is_file():
                        shutil.copy2(source, backup / label)
                try:
                    raw = await connector.fetch_chapter(fetcher, chapter.source_url)
                    norm = connector.normalize_chapter(raw)
                    localized = await localize_chapter_images(fetcher, norm.html, raw.url,
                                                             connector.id, slug, remove_unavailable=True)
                    tree = HTMLParser(localized.html)
                    if not tree.text(strip=True) and tree.css_first("img[src]") is None:
                        raise ValueError("No content after image localization")
                except Exception as exc:
                    item.update(status="failed", error=str(exc))
                    report["failed"] += 1
                else:
                    chapter.raw_path = storage.save_raw(connector.id, slug, float(chapter.number), raw.html)
                    chapter.content_path = storage.save_content(connector.id, slug, float(chapter.number), localized.html)
                    chapter.content_hash = storage.sha256(localized.html)
                    chapter.word_count = norm.word_count
                    chapter.downloaded = True
                    chapter.fetched_at = datetime.now(timezone.utc)
                    novel.updated_at = datetime.now(timezone.utc)
                    await session.commit()
                    item.update(status="repaired", words=norm.word_count)
                    report["repaired"] += 1
                print(json.dumps(item, ensure_ascii=False), flush=True)
                if progress:
                    await progress(item)
                (report_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    finally:
        await fetcher.aclose()
        (report_dir / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"report={report_dir / 'report.json'} repaired={report['repaired']} failed={report['failed']}", flush=True)
    return report


async def run_all(audit_path: Path) -> dict:
    audit = json.loads(audit_path.read_text(encoding="utf-8"))
    groups = {}
    for item in audit["chapters"]:
        if item["source"] == "novel-mania" and item["status"] in ("empty", "missing_file"):
            groups.setdefault(item["slug"], []).append(item)
    stats = {"stage": "repair_empty", "novels_total": len(groups), "novels_done": 0,
             "novels_failed": 0, "chapters_new": 0, "chapters_repaired": 0,
             "chapters_seen": 0, "chapters_skipped": 0, "errors": 0,
             "repair_total": sum(len(items) for items in groups.values()),
             "last_event": "Recuperando capitulos vazios do Novel Mania"}
    async with SessionLocal() as session:
        crawl = CrawlRun(source_id="novel-mania", status="running", stats=stats)
        session.add(crawl)
        await session.commit()
        run_id = crawl.id

    async def update(status=None, error=None):
        async with SessionLocal() as session:
            crawl = await session.get(CrawlRun, run_id)
            stats["last_heartbeat_at"] = datetime.now(timezone.utc).isoformat()
            crawl.stats = dict(stats)
            if status:
                crawl.status = status
                crawl.finished_at = datetime.now(timezone.utc)
                crawl.error = error
            await session.commit()

    consecutive_failures = 0

    async def progress(item):
        nonlocal consecutive_failures
        stats["current_chapter_number"] = item["number"]
        stats["current_chapter_title"] = item["title"]
        if item["status"] != "empty":
            stats["chapters_seen"] += 1
            stats["current_novel_chapters_done"] += 1
        if item["status"] == "repaired":
            consecutive_failures = 0
            stats["chapters_repaired"] += 1
            stats["chapters_new"] += 1
        elif item["status"] == "failed":
            consecutive_failures += 1
            stats["errors"] += 1
        stats["last_event"] = f"Reparo #{item['number']:g}: {item['status']} ({stats['chapters_repaired']}/{stats['repair_total']})"
        await update()
        if consecutive_failures >= 5:
            raise RuntimeError("Repair stopped after five consecutive failures; inspect logs before retrying")

    print(f"crawl_run={run_id} novels={len(groups)} chapters={stats['repair_total']}", flush=True)
    try:
        for index, (slug, items) in enumerate(groups.items(), start=1):
            stats.update(current_novel_index=index, current_novel_title=items[0]["title"],
                         current_novel_chapters_total=len(items), current_novel_chapters_done=0)
            await update()
            result = await run(slug, True, progress)
            stats["novels_done"] += 1
            stats["novels_failed"] += bool(result["failed"])
            await update()
        stats["stage"] = "done"
        stats["last_event"] = "Recuperacao finalizada; publicacao B2 pendente"
        await update("error" if stats["errors"] else "done")
    except BaseException as exc:
        stats["stage"] = "repair_error"
        stats["last_event"] = str(exc)
        await update("error", str(exc))
        raise
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--slug")
    target.add_argument("--all-from-audit", type=Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--lock-file", type=Path)
    args = parser.parse_args()
    if args.all_from_audit and not args.apply:
        parser.error("--all-from-audit requires --apply; use audit-empty-chapters.py for read-only audit")
    lock = None
    if args.lock_file:
        import fcntl
        lock = args.lock_file.open("a")
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    result = asyncio.run(run_all(args.all_from_audit) if args.all_from_audit else run(args.slug, args.apply))
    raise SystemExit(1 if result.get("failed", result.get("errors", 0)) else 0)
