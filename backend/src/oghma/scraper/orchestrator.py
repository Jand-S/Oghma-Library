"""Orquestra um crawl: descobre -> baixa -> normaliza -> grava (incremental)."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..models import Chapter, CrawlRun, Novel, SourceSite
from ..taxonomy import canonical_tag_keys
from . import connectors  # noqa: F401  (registra conectores)
from . import registry
from .base import ChapterRef, NovelMeta, NovelRef
from .chapter_assets import localize_chapter_images
from .fetcher import HttpFetcher

PROGRESS_LOG_EVERY_CHAPTERS = 10
COVER_REFRESH_AFTER = timedelta(days=180)


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


def _cover_needs_refresh(
    novel: Novel | None,
    meta: NovelMeta,
    *,
    now: datetime | None = None,
) -> bool:
    if not meta.cover_url:
        return False
    if novel is None or not novel.cover_path:
        return True

    path = Path(novel.cover_path)
    if not path.is_file() or novel.cover_url != meta.cover_url:
        return True

    checked_at = (novel.extra or {}).get("cover_checked_at")
    try:
        checked = datetime.fromisoformat(str(checked_at)) if checked_at else None
    except ValueError:
        checked = None
    if checked is None:
        checked = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    elif checked.tzinfo is None:
        checked = checked.replace(tzinfo=timezone.utc)
    return (now or _now()) - checked >= COVER_REFRESH_AFTER


def _mark_cover_checked(novel: Novel) -> None:
    extra = dict(novel.extra or {})
    extra["cover_checked_at"] = _now_iso()
    novel.extra = extra


async def _download_cover(
    fetcher: HttpFetcher,
    meta: NovelMeta,
    existing_path: str | None,
    *,
    refresh: bool = False,
) -> tuple[str | None, bool]:
    if not meta.cover_url:
        return existing_path, False
    if existing_path and Path(existing_path).exists() and not refresh:
        return existing_path, False

    raw = await fetcher.get(meta.cover_url)
    content_type = (raw.content_type or "").split(";", 1)[0].strip().lower()
    if content_type.startswith("text/"):
        return existing_path, False
    ext = _cover_extension(raw.url, raw.content_type, raw.html)
    return storage.save_cover(meta.source_id, meta.slug, raw.html, ext), True


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
    nv.tag_keys = canonical_tag_keys(meta.tags)
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
        curl_bin=getattr(connector, "curl_bin", "curl"),
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
        "covers_refreshed": 0,
        "covers_skipped": 0,
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

                existing_nv = await session.get(Novel, novel_id)
                meta = await connector.fetch_novel(fetcher, ref)
                stats["current_novel_title"] = meta.title
                cover_due = _cover_needs_refresh(existing_nv, meta)
                nv = await _upsert_novel(session, novel_id, meta)
                stats["stage"] = "cover"
                stats["last_event"] = (
                    f"refreshing cover for {meta.title}"
                    if cover_due
                    else f"cover current for {meta.title}"
                )
                await _save_run_progress(session, run_id, stats)
                if cover_due:
                    previous_cover_path = nv.cover_path
                    try:
                        cover_path, downloaded = await _download_cover(
                            fetcher,
                            meta,
                            nv.cover_path,
                            refresh=True,
                        )
                    except Exception:
                        stats["cover_errors"] += 1
                    else:
                        if downloaded and cover_path:
                            nv.cover_path = cover_path
                            _mark_cover_checked(nv)
                            if previous_cover_path:
                                stats["covers_refreshed"] += 1
                            else:
                                stats["covers_new"] += 1
                else:
                    stats["covers_skipped"] += 1
                new = 0
                current_count = int(
                    await session.scalar(
                        select(func.count()).select_from(Chapter).where(Chapter.novel_id == novel_id)
                    )
                    or 0
                )
                latest_chapter = await session.scalar(
                    select(Chapter)
                    .where(Chapter.novel_id == novel_id)
                    .order_by(Chapter.number.desc())
                    .limit(1)
                )
                incremental_lister = getattr(connector, "list_chapters_after", None)
                chapter_offset = 0
                if (
                    not refresh
                    and current_count > 0
                    and meta.source_chapter_count is not None
                    and current_count >= meta.source_chapter_count
                ):
                    chapters = []
                    chapter_offset = current_count
                    stats["stage"] = "chapters_current"
                    stats["last_event"] = f"{meta.title}: chapter total unchanged ({current_count})"
                elif (
                    not refresh
                    and callable(incremental_lister)
                    and latest_chapter is not None
                    and latest_chapter.source_url
                ):
                    stats["stage"] = "checking_updates"
                    stats["last_event"] = f"{meta.title}: checking after chapter {latest_chapter.number:g}"
                    await _save_run_progress(session, run_id, stats)
                    latest_ref = ChapterRef(
                        number=float(latest_chapter.number),
                        title=latest_chapter.title,
                        url=latest_chapter.source_url,
                        published_at=latest_chapter.published_at,
                    )
                    try:
                        chapters = await incremental_lister(fetcher, meta, latest_ref)
                    except Exception:
                        stats["stage"] = "listing_chapters"
                        stats["last_event"] = f"{meta.title}: incremental check failed; scanning full list"
                        await _save_run_progress(session, run_id, stats)
                        chapters = await connector.list_chapters(fetcher, meta)
                    else:
                        chapter_offset = current_count
                else:
                    stats["stage"] = "listing_chapters"
                    stats["last_event"] = f"{meta.title}: listing chapters"
                    await _save_run_progress(session, run_id, stats)
                    chapters = await connector.list_chapters(fetcher, meta)
                stats["stage"] = "chapters"
                stats["current_novel_chapters_total"] = chapter_offset + len(chapters)
                stats["current_novel_chapters_done"] = chapter_offset
                stats["last_event"] = (
                    f"{meta.title}: found {len(chapters)} new chapters"
                    if chapter_offset
                    else f"{meta.title}: listed {len(chapters)} chapters"
                )
                if chapter_offset:
                    stats["chapters_seen"] += chapter_offset
                    stats["chapters_skipped"] += chapter_offset
                nv = await session.get(Novel, novel_id)
                if nv is not None:
                    nv.chapter_count = current_count
                await _save_run_progress(session, run_id, stats)
                _log_progress(
                    f"chapters listed novel={novel_id} total={chapter_offset + len(chapters)} "
                    f"new_candidates={len(chapters)}"
                )
                for chapter_index, cref in enumerate(chapters, start=1):
                    progress_index = chapter_offset + chapter_index
                    cid = f"{novel_id}#{cref.number:g}"
                    stats["chapters_seen"] += 1
                    stats["current_novel_chapters_done"] = progress_index
                    stats["current_chapter_number"] = float(cref.number)
                    stats["current_chapter_title"] = cref.title
                    if (await session.get(Chapter, cid)) is not None and not refresh:
                        stats["chapters_skipped"] += 1
                        if chapter_index == 1 or chapter_index % PROGRESS_LOG_EVERY_CHAPTERS == 0:
                            stats["stage"] = "skipping_existing"
                            stats["last_event"] = (
                                f"{meta.title}: skipped existing chapter "
                                f"{progress_index}/{chapter_offset + len(chapters)}"
                            )
                            await _save_run_progress(session, run_id, stats)
                        continue
                    stats["stage"] = "downloading_chapter"
                    stats["last_event"] = (
                        f"{meta.title}: downloading chapter "
                        f"{progress_index}/{chapter_offset + len(chapters)} "
                        f"#{cref.number:g}"
                    )
                    await _save_run_progress(session, run_id, stats)
                    raw = await connector.fetch_chapter(fetcher, cref.url)
                    norm = connector.normalize_chapter(raw)
                    localized = await localize_chapter_images(
                        fetcher,
                        norm.html,
                        raw.url,
                        source_id,
                        ref.slug,
                        remove_unavailable=True,
                    )
                    norm.html = localized.html
                    if localized.references:
                        norm.text_hash = storage.sha256(norm.html)
                        stats.setdefault("chapter_images_downloaded", 0)
                        stats.setdefault("chapter_images_reused", 0)
                        stats.setdefault("chapter_image_errors", 0)
                        stats["chapter_images_downloaded"] += localized.downloaded
                        stats["chapter_images_reused"] += localized.reused
                        stats["chapter_image_errors"] += localized.failed
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
                            f"{progress_index}/{chapter_offset + len(chapters)} "
                            f"number={cref.number:g} new={new}"
                        )
                    stats["last_event"] = (
                        f"{meta.title}: saved chapter "
                        f"{progress_index}/{chapter_offset + len(chapters)} "
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
