from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..models import Chapter, CrawlRun, Novel, SourceSite
from ..schemas import (
    BootstrapOut,
    ChapterOut,
    ChapterPage,
    CrawlRunOut,
    NovelOut,
    SourceOut,
)
from .deps import get_db
from . import publish_jobs

router = APIRouter(prefix="/api")


def _source_out(s: SourceSite) -> SourceOut:
    return SourceOut(
        id=s.id,
        name=s.name,
        base_url=s.base_url,
        count=s.novel_count,
        status="online" if s.enabled else "offline",
        enabled=s.enabled,
        mode=s.mode,
        last_sync=s.last_sync_at.isoformat() if s.last_sync_at else "",
        delay_ms=int(s.rate_limit_seconds * 1000),
    )


def _novel_out(n: Novel, source_name: str = "") -> NovelOut:
    return NovelOut(
        id=n.id,
        title=n.title,
        author=n.author or "",
        source_id=n.source_id,
        source_name=source_name,
        tags=list(n.tags or []),
        status=n.status,
        chapters=n.chapter_count,
        language=n.language,
        updated_at=n.updated_at.isoformat() if n.updated_at else "",
        description=n.description or "",
        cover_url=n.cover_url,
    )


def _crawl_run_out(run) -> CrawlRunOut:
    return CrawlRunOut(
        id=int(run.id),
        source_id=run.source_id,
        status=run.status,
        stats=dict(run.stats or {}),
        error=run.error or "",
        started_at=run.started_at.isoformat() if run.started_at else "",
        finished_at=run.finished_at.isoformat() if run.finished_at else "",
    )


@router.get("/sources", response_model=list[SourceOut])
async def list_sources(db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(select(SourceSite).order_by(SourceSite.name))).all()
    return [_source_out(s) for s in rows]


@router.get("/novels", response_model=list[NovelOut])
async def search_novels(
    db: AsyncSession = Depends(get_db),
    query: str | None = None,
    sourceId: str | None = None,
    status: str | None = None,
    language: str | None = None,
    minChapters: int = 0,
    maxChapters: int | None = None,
    limit: int = Query(60, le=200),
    offset: int = 0,
):
    stmt = select(Novel)
    if query:
        stmt = stmt.where(Novel.title.ilike(f"%{query}%"))
    if sourceId and sourceId != "all":
        stmt = stmt.where(Novel.source_id == sourceId)
    if status and status != "any":
        stmt = stmt.where(Novel.status == status)
    if language and language not in ("all", ""):
        stmt = stmt.where(Novel.language.ilike(language))
    if minChapters:
        stmt = stmt.where(Novel.chapter_count >= minChapters)
    if maxChapters is not None:
        stmt = stmt.where(Novel.chapter_count <= maxChapters)
    stmt = stmt.order_by(Novel.updated_at.desc()).limit(limit).offset(offset)
    rows = (await db.scalars(stmt)).all()
    names = dict((await db.execute(select(SourceSite.id, SourceSite.name))).all())
    return [_novel_out(n, names.get(n.source_id, "")) for n in rows]


@router.get("/novels/{novel_id}/chapters", response_model=ChapterPage)
async def novel_chapters(
    novel_id: str,
    db: AsyncSession = Depends(get_db),
    page: int = 1,
    pageSize: int = Query(100, le=500),
    downloaded: bool | None = None,
):
    base = select(Chapter).where(Chapter.novel_id == novel_id)
    if downloaded is not None:
        base = base.where(Chapter.downloaded == downloaded)
    total = await db.scalar(
        select(func.count()).select_from(base.subquery())
    )
    rows = (
        await db.scalars(
            base.order_by(Chapter.number).limit(pageSize).offset((page - 1) * pageSize)
        )
    ).all()
    items = [
        ChapterOut(
            id=c.id,
            novel_id=c.novel_id,
            number=float(c.number),
            title=c.title,
            downloaded=c.downloaded,
            word_count=c.word_count,
        )
        for c in rows
    ]
    return ChapterPage(items=items, page=page, page_size=pageSize, total=int(total or 0))


@router.get("/chapters/{chapter_id:path}/content")
async def chapter_content(chapter_id: str, db: AsyncSession = Depends(get_db)):
    ch = await db.get(Chapter, chapter_id)
    if ch is None or not ch.content_path:
        raise HTTPException(status_code=404, detail="capitulo nao encontrado")
    try:
        html = storage.read_content(ch.content_path)
    except FileNotFoundError:
        raise HTTPException(status_code=410, detail="conteudo indisponivel no storage")
    return {"id": ch.id, "title": ch.title, "html": html}


@router.get("/crawls", response_model=list[CrawlRunOut])
async def list_crawls(
    db: AsyncSession = Depends(get_db),
    sourceId: str | None = None,
    status: str | None = None,
    limit: int = Query(20, le=100),
):
    stmt = select(CrawlRun)
    if sourceId:
        stmt = stmt.where(CrawlRun.source_id == sourceId)
    if status:
        stmt = stmt.where(CrawlRun.status == status)
    stmt = stmt.order_by(CrawlRun.started_at.desc()).limit(limit)
    rows = (await db.scalars(stmt)).all()
    return [_crawl_run_out(row) for row in rows]


@router.get("/stats")
async def stats(db: AsyncSession = Depends(get_db)):
    novels = int(await db.scalar(select(func.count()).select_from(Novel)) or 0)
    chapters = int(await db.scalar(select(func.count()).select_from(Chapter)) or 0)
    covers = int(
        await db.scalar(
            select(func.count()).select_from(Novel).where(Novel.cover_path.is_not(None))
        )
        or 0
    )
    sources = int(await db.scalar(select(func.count()).select_from(SourceSite)) or 0)
    running_crawls = int(
        await db.scalar(
            select(func.count()).select_from(CrawlRun).where(CrawlRun.status == "running")
        )
        or 0
    )
    return {
        "sources": sources,
        "novels": novels,
        "chapters": chapters,
        "covers": covers,
        "runningCrawls": running_crawls,
    }


@router.post("/publish/run")
async def publish_run(background: BackgroundTasks, source: str = "central-novel"):
    ok, job = await publish_jobs.start_publish(source)
    if not ok:
        return {"ok": False, "reason": "already_running", "job": job}
    background.add_task(publish_jobs.run_publish, source)
    return {"ok": True, "job": job}


@router.get("/publish/status")
async def publish_status():
    return publish_jobs.snapshot()


@router.get("/bootstrap", response_model=BootstrapOut)
async def bootstrap(db: AsyncSession = Depends(get_db)):
    sources = (await db.scalars(select(SourceSite).order_by(SourceSite.name))).all()
    names = {s.id: s.name for s in sources}
    novels = (await db.scalars(select(Novel).order_by(Novel.updated_at.desc()).limit(60))).all()
    return BootstrapOut(
        sources=[_source_out(s) for s in sources],
        novels=[_novel_out(n, names.get(n.source_id, "")) for n in novels],
        queue=[],
        library=[],
    )
