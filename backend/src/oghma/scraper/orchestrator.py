"""Orquestra um crawl: descobre -> baixa -> normaliza -> grava (incremental)."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..models import Chapter, CrawlRun, Novel, SourceSite
from . import connectors  # noqa: F401  (registra conectores)
from . import registry
from .base import ChapterRef, NovelMeta, NovelRef
from .fetcher import HttpFetcher

PROGRESS_LOG_EVERY_CHAPTERS = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _log_progress(message: str) -> None:
    print(f"[{_now_iso()}] {message}", flush=True)


async def _save_run_progress(
    session: AsyncSession,
    run_id: int,
    stats: dict,
    *,
    status: str | None = None,
    error: str | None = None,
) -> None:
    run = await session.get(CrawlRun, run_id)
    if run is None:
        return
    stats["last_heartbeat_at"] = _now_iso()
    run.stats = dict(stats)
    if status is not None:
        run.status = status
    if error is not None:
        run.error = error
    await session.commit()


def _cover_extension(url: str, content_type: str | None, data: bytes) -> str:
    content_type = (content_type or "").split(";", 1)[0].strip().lower()
    by_content_type = {
        "image/jpeg": "jpg",
        "image/jpg": "jpg",
        "image/png": "png",
        "image/webp": "webp",
        "image/gif": "gif",
    }
    if content_type in by_content_type:
        return by_content_type[content_type]

    suffix = Path(urlsplit(url).path).suffix.lower().lstrip(".")
    if suffix == "jpeg":
        return "jpg"
    if suffix in {"jpg", "png", "webp", "gif"}:
        return suffix

    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return "webp"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return "gif"
    return "jpg"


async def _download_cover(fetcher: HttpFetcher, meta: NovelMeta, existing_path: str | None) -> str | None:
    if not meta.cover_url:
        return existing_path
    if existing_path and Path(existing_path).exists():
        return existing_path

    raw = await fetcher.get(meta.cover_url)
    content_type = (raw.content_type or "").split(";", 1)[0].strip().lower()
    if content_type.startswith("text/"):
        return existing_path
    ext = _cover_extension(raw.url, raw.content_type, raw.html)
    return storage.save_cover(meta.source_id, meta.slug, raw.html, ext)


async def _upsert_novel(session: AsyncSession, novel_id: str, meta: NovelMeta) -> Novel:
    nv = await session.get(Novel, novel_id)
    if nv is None:
        nv = Novel(id=novel_id, source_id=meta.source_id, slug=meta.slug, source_url=meta.url)
        session.add(nv)
    nv.title = meta.title
    nv.author = meta.author
    nv.description = meta.description
    nv.cover_url = meta.cover_url
    nv.language = meta.language
    nv.status = meta.status
    nv.tags = meta.tags
    nv.source_url = meta.url
    return nv


async def _upsert_chapter(session, cid, novel_id, cref: ChapterRef, norm, raw_path, content_path):
    ch = await session.get(Chapter, cid)
    if ch is None:
        ch = Chapter(id=cid, novel_id=novel_id, number=cref.number)
        session.add(ch)
    ch.title = cref.title
    ch.source_url = cref.url
    ch.published_at = cref.published_at
    ch.raw_path = raw_path
    ch.content_path = content_path
    ch.content_hash = norm.text_hash
    ch.word_count = norm.word_count
    ch.downloaded = True
    ch.fetched_at = _now()


async def crawl_source(
    session: AsyncSession,
    source_id: str,
    limit: int | None = None,
    chapter_limit: int | None = None,
    refresh: bool = False,
) -> dict:
    connector = registry.get(source_id)
    headers_provider = getattr(connector, "request_headers", None)
    headers = headers_provider() if callable(headers_provider) else getattr(connector, "headers", None)
    fetcher = HttpFetcher(
        connector.rate_limit_seconds,
        headers=headers,
        http2=getattr(connector, "http2", True),
        use_curl=getattr(connector, "use_curl", False),
    )
    run = CrawlRun(source_id=source_id, status="running")
    session.add(run)
    await session.commit()
    run_id = int(run.id)

    stats = {
        "source_id": source_id,
        "stage": "starting",
        "discovered_total": 0,
        "novels": 0,
        "novels_total": 0,
        "novels_done": 0,
        "novels_failed": 0,
        "chapters_seen": 0,
        "chapters_new": 0,
        "chapters_skipped": 0,
        "covers_new": 0,
        "errors": 0,
        "cover_errors": 0,
        "current_novel_index": 0,
        "current_novel_id": "",
        "current_novel_title": "",
        "current_novel_slug": "",
        "current_novel_chapters_total": 0,
        "current_novel_chapters_done": 0,
        "current_chapter_number": None,
        "current_chapter_title": "",
        "last_event": "crawl starting",
        "last_heartbeat_at": _now_iso(),
    }
    await _save_run_progress(session, run_id, stats)
    _log_progress(f"crawl start source={source_id}")
    try:
        refs: list[NovelRef] = list(await connector.discover_novels(fetcher, limit=limit))
        stats["stage"] = "discovered"
        stats["discovered_total"] = len(refs)
        stats["novels_total"] = len(refs)
        stats["last_event"] = f"discovered {len(refs)} novels"
        await _save_run_progress(session, run_id, stats)
        _log_progress(f"discovered source={source_id} novels={len(refs)}")
        for index, ref in enumerate(refs, start=1):
            novel_id = f"{source_id}:{ref.slug}"
            try:
                stats["stage"] = "fetch_novel"
                stats["current_novel_index"] = index
                stats["current_novel_id"] = novel_id
                stats["current_novel_slug"] = ref.slug
                stats["current_novel_title"] = ref.slug
                stats["current_novel_chapters_total"] = 0
                stats["current_novel_chapters_done"] = 0
                stats["current_chapter_number"] = None
                stats["current_chapter_title"] = ""
                stats["last_event"] = f"fetching novel {index}/{len(refs)} {ref.slug}"
                await _save_run_progress(session, run_id, stats)
                _log_progress(f"novel start {index}/{len(refs)} id={novel_id}")

                meta = await connector.fetch_novel(fetcher, ref)
                stats["current_novel_title"] = meta.title
                nv = await _upsert_novel(session, novel_id, meta)
                stats["stage"] = "cover"
                stats["last_event"] = f"checking cover for {meta.title}"
                await _save_run_progress(session, run_id, stats)
                try:
                    cover_path = await _download_cover(fetcher, meta, nv.cover_path)
                except Exception:
                    stats["cover_errors"] += 1
                else:
                    if cover_path and cover_path != nv.cover_path:
                        nv.cover_path = cover_path
                        stats["covers_new"] += 1
                new = 0
                chapters = await connector.list_chapters(fetcher, meta)
                stats["stage"] = "chapters"
                stats["current_novel_chapters_total"] = len(chapters)
                stats["last_event"] = f"{meta.title}: listed {len(chapters)} chapters"
                current_count = int(
                    await session.scalar(
                        select(func.count()).select_from(Chapter).where(Chapter.novel_id == novel_id)
                    )
                    or 0
                )
                nv = await session.get(Novel, novel_id)
                if nv is not None:
                    nv.chapter_count = current_count
                await _save_run_progress(session, run_id, stats)
                _log_progress(f"chapters listed novel={novel_id} total={len(chapters)}")
                for chapter_index, cref in enumerate(chapters, start=1):
                    cid = f"{novel_id}#{cref.number:g}"
                    stats["chapters_seen"] += 1
                    stats["current_novel_chapters_done"] = chapter_index
                    stats["current_chapter_number"] = float(cref.number)
                    stats["current_chapter_title"] = cref.title
                    if (await session.get(Chapter, cid)) is not None and not refresh:
                        stats["chapters_skipped"] += 1
                        if chapter_index == 1 or chapter_index % PROGRESS_LOG_EVERY_CHAPTERS == 0:
                            stats["stage"] = "skipping_existing"
                            stats["last_event"] = f"{meta.title}: skipped existing chapter {chapter_index}/{len(chapters)}"
                            await _save_run_progress(session, run_id, stats)
                        continue
                    stats["stage"] = "downloading_chapter"
                    stats["last_event"] = (
                        f"{meta.title}: downloading chapter {chapter_index}/{len(chapters)} "
                        f"#{cref.number:g}"
                    )
                    await _save_run_progress(session, run_id, stats)
                    raw = await connector.fetch_chapter(fetcher, cref.url)
                    norm = connector.normalize_chapter(raw)
                    raw_path = storage.save_raw(source_id, ref.slug, cref.number, raw.html)
                    content_path = storage.save_content(source_id, ref.slug, cref.number, norm.html)
                    await _upsert_chapter(session, cid, novel_id, cref, norm, raw_path, content_path)
                    current_count += 1
                    nv = await session.get(Novel, novel_id)
                    if nv is not None:
                        nv.chapter_count = current_count
                        nv.last_crawled_at = _now()
                    new += 1
                    stats["chapters_new"] += 1
                    if new <= 3 or new % PROGRESS_LOG_EVERY_CHAPTERS == 0:
                        _log_progress(
                            f"chapter saved novel={novel_id} "
                            f"{chapter_index}/{len(chapters)} number={cref.number:g} new={new}"
                        )
                    stats["last_event"] = (
                        f"{meta.title}: saved chapter {chapter_index}/{len(chapters)} "
                        f"#{cref.number:g}"
                    )
                    await _save_run_progress(session, run_id, stats)
                    if chapter_limit and new >= chapter_limit:
                        break
                count = await session.scalar(
                    select(func.count()).select_from(Chapter).where(Chapter.novel_id == novel_id)
                )
                nv = await session.get(Novel, novel_id)
                if nv is not None:
                    nv.chapter_count = int(count or 0)
                    nv.last_crawled_at = _now()
                await session.commit()
                stats["novels"] += 1
                stats["novels_done"] += 1
                stats["stage"] = "novel_done"
                stats["last_event"] = f"finished {meta.title}: {new} new chapters"
                await _save_run_progress(session, run_id, stats)
                _log_progress(f"novel done {index}/{len(refs)} id={novel_id} new_chapters={new}")
            except Exception:
                stats["errors"] += 1
                stats["novels_failed"] += 1
                await session.rollback()
                stats["stage"] = "novel_error"
                stats["last_event"] = f"error while processing {novel_id}"
                await _save_run_progress(session, run_id, stats)
                _log_progress(f"novel error id={novel_id}")
        run.status = "done"
        stats["stage"] = "done"
        stats["last_event"] = "crawl done"
    except Exception as exc:  # falha geral
        run.status = "error"
        run.error = str(exc)
        stats["stage"] = "crawl_error"
        stats["last_event"] = str(exc)
    finally:
        run = await session.get(CrawlRun, run_id) or run
        run.finished_at = _now()
        run.stats = dict(stats)
        src = await session.get(SourceSite, source_id)
        if src is not None:
            src.novel_count = int(
                await session.scalar(
                    select(func.count()).select_from(Novel).where(Novel.source_id == source_id)
                )
                or 0
            )
            src.last_sync_at = _now()
        await session.commit()
        await fetcher.aclose()
        _log_progress(f"crawl finish source={source_id} status={run.status} stats={stats}")
    return stats
