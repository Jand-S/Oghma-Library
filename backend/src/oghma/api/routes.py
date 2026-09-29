from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import storage
from ..db import SessionLocal
from ..models import Chapter, CrawlRun, Novel, SourceSite
from ..schemas import (
    BootstrapOut,
    ChapterOut,
    ChapterPage,
    CrawlRunOut,
    NovelOut,
    SourceOut,
    TagCatalogOut,
    TranslationEstimateOut,
    TranslationEstimateRequest,
    TranslationModelRecommendationOut,
    TranslationCoverageOut,
    TranslationCoverageRangeOut,
    TranslationJobCreateRequest,
    TranslationJobOut,
    TranslationJobStatsOut,
    TranslationAutomaticPlanRequest,
    TranslationAutomaticPlanOut,
    TranslationAutomaticSampleOut,
    TranslationSelectionRecordOut,
    TranslationSelectionTrialOut,
    TranslationMemoryConflictOut,
    TranslationMemoryConflictResolveOut,
    TranslationMemoryConflictResolveRequest,
    TranslationMemoryConflictSuggestionOut,
    TranslationMemoryTermOut,
    TranslationMemoryTermUpsertRequest,
    TranslationMemoryTermUpsertOut,
    TranslationPostEditResultOut,
    TranslationPricingRefreshOut,
    TranslationPricingSnapshotOut,
)
from ..taxonomy import TAXONOMY_VERSION, build_tag_items, canonical_tag_keys
from ..translation.auto_select import CandidateChapter, build_automatic_selection_plan
from ..translation.coverage import SourceChapterRef, build_coverage, load_coverage_records
from ..translation.coverage_store import (
    load_coverage_rows,
    merge_coverage_records,
    upsert_coverage_row,
    upsert_coverage_rows,
)
from ..translation.jobs import (
    TranslationJob,
    create_translation_job,
    get_translation_job,
    load_translation_jobs,
    update_translation_job_status,
    upsert_translation_job,
)
from ..translation.job_store import (
    get_job_row,
    list_job_rows,
    update_job_row_status,
    upsert_job_row,
)
from ..translation.planner import (
    DEFAULT_TRANSLATION_MODELS,
    build_translation_plan,
    build_translation_plan_from_metrics,
)
from ..translation.pricing import (
    PricingSnapshot,
    load_pricing_snapshots,
    refresh_direct_pricing_snapshot,
    refresh_openrouter_pricing_snapshot,
    save_pricing_snapshots,
)
from ..translation.pricing_store import (
    load_pricing_snapshot_rows,
    merge_pricing_snapshots,
    upsert_pricing_snapshots,
)
from ..translation.memory import (
    MemoryConflict,
    MemoryConflictSuggestion,
    TranslationMemoryTerm,
    detect_memory_conflicts_from_terms,
    load_memory_terms,
    suggest_memory_conflict_resolutions_from_terms,
    upsert_manual_memory_term,
    upsert_memory_terms,
)
from ..translation.memory_store import load_memory_term_rows, merge_memory_terms, upsert_memory_term_row, upsert_memory_term_rows
from ..translation.post_edit import ReplacementTerm, apply_replacements_to_coverage
from ..translation.selection_history import (
    AutomaticSelectionRecord,
    load_selection_records,
    append_selection_record,
    winning_models_for_novel,
)
from ..translation.selection_store import load_selection_rows, merge_selection_records, upsert_selection_rows
from ..translation.providers import OpenAIProvider
from ..translation.worker import TranslationWorkChapter, execute_translation_job, provider_for_job
from .deps import get_db
from . import publish_jobs

router = APIRouter(prefix="/api")

EROTIC_TAG_KEYS = {
    "genre.adult",
    "genre.erotic",
    "genre.explicit_erotic",
    "theme.bdsm",
    "theme.dirty_talk",
    "theme.dominance",
    "theme.incest",
    "theme.milf",
    "theme.dilf",
    "theme.nonconsensual",
    "theme.sex_friends",
    "theme.sex_slaves",
    "theme.threesome",
    "theme.voyeurism",
}

SUGGESTIVE_TAG_KEYS = {
    "genre.ecchi",
    "theme.cross_dressing",
    "theme.gender_bender",
    "theme.genderswap",
    "theme.harem",
    "theme.loli",
    "theme.monster_girls",
    "theme.reverse_harem",
    "theme.shota",
    "theme.slow_burn_romance",
    "theme.tsundere",
}


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
        tag_keys=list(n.tag_keys or []),
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
    includeTag: list[str] = Query(default=[]),
    excludeTag: list[str] = Query(default=[]),
    contentRating: str | None = None,
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
    if includeTag:
        if len(includeTag) > 32:
            raise HTTPException(status_code=400, detail="tags obrigatorias demais")
        stmt = stmt.where(Novel.tag_keys.contains(includeTag))
    if excludeTag:
        if len(excludeTag) > 32:
            raise HTTPException(status_code=400, detail="tags proibidas demais")
        stmt = stmt.where(~Novel.tag_keys.overlap(excludeTag))
    if contentRating and contentRating != "all":
        if contentRating not in ("safe", "suggestive", "erotic"):
            raise HTTPException(status_code=400, detail="classificacao de conteudo invalida")
        erotic_keys = sorted(EROTIC_TAG_KEYS)
        suggestive_keys = sorted(SUGGESTIVE_TAG_KEYS)
        if contentRating == "erotic":
            stmt = stmt.where(Novel.tag_keys.overlap(erotic_keys))
        elif contentRating == "suggestive":
            stmt = stmt.where(Novel.tag_keys.overlap(suggestive_keys))
            stmt = stmt.where(~Novel.tag_keys.overlap(erotic_keys))
        else:
            stmt = stmt.where(~Novel.tag_keys.overlap(sorted(EROTIC_TAG_KEYS | SUGGESTIVE_TAG_KEYS)))
    if minChapters:
        stmt = stmt.where(Novel.chapter_count >= minChapters)
    if maxChapters is not None:
        stmt = stmt.where(Novel.chapter_count <= maxChapters)
    stmt = stmt.order_by(Novel.updated_at.desc()).limit(limit).offset(offset)
    rows = (await db.scalars(stmt)).all()
    names = dict((await db.execute(select(SourceSite.id, SourceSite.name))).all())
    return [_novel_out(n, names.get(n.source_id, "")) for n in rows]


@router.get("/tags", response_model=TagCatalogOut)
async def list_tags(
    db: AsyncSession = Depends(get_db),
    sourceId: str | None = None,
):
    stmt = select(Novel.tags, Novel.tag_keys)
    if sourceId and sourceId != "all":
        stmt = stmt.where(Novel.source_id == sourceId)
    rows = (await db.execute(stmt)).all()
    counts: dict[str, int] = {}
    raw_labels: dict[str, set[str]] = {}
    for raw_tags, tag_keys in rows:
        raw_tags = list(raw_tags or [])
        keys = list(tag_keys or []) or canonical_tag_keys(raw_tags)
        for key in set(keys):
            counts[key] = counts.get(key, 0) + 1
        for raw in raw_tags:
            key = canonical_tag_keys([raw])
            if not key:
                continue
            raw_labels.setdefault(key[0], set()).add(raw)
    return TagCatalogOut(
        taxonomy_version=TAXONOMY_VERSION,
        items=build_tag_items(counts, raw_labels),
    )


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


@router.post("/translations/estimate", response_model=TranslationEstimateOut)
async def estimate_translation(
    request: TranslationEstimateRequest,
    db: AsyncSession = Depends(get_db),
):
    if request.chapter_to < request.chapter_from:
        raise HTTPException(status_code=400, detail="intervalo de capitulos invalido")
    rows = await _chapters_in_range(
        db,
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
    )
    html = list(_chapter_html_by_number(rows).values())
    if not html and not request.source_chars:
        raise HTTPException(status_code=404, detail="nenhum capitulo baixado encontrado no intervalo")

    await _ensure_fresh_pricing(db, request.models or DEFAULT_TRANSLATION_MODELS)
    plan = (
        build_translation_plan(
            html,
            mode=request.mode,
            models=request.models,
            usd_brl_rate=request.usd_brl_rate,
        )
        if html
        else build_translation_plan_from_metrics(
            chapter_count=max(1, round(request.chapter_to - request.chapter_from + 1)),
            source_chars=request.source_chars or 1,
            mode=request.mode,
            models=request.models,
            usd_brl_rate=request.usd_brl_rate,
        )
    )
    return TranslationEstimateOut(
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
        chapter_count=plan.chapter_count,
        source_chars=plan.source_chars,
        estimated_input_tokens=plan.estimated_input_tokens,
        estimated_output_tokens=plan.estimated_output_tokens,
        mode=plan.mode,
        recommendations=[
            TranslationModelRecommendationOut(
                model=item.model,
                estimated_usd=item.estimated_usd,
                estimated_brl=item.estimated_brl,
                estimated_duration_seconds=item.estimated_duration_seconds,
                quality_score=item.quality_score,
                gate_pass_rate=item.gate_pass_rate,
                recommendation_score=item.recommendation_score,
                experimental=item.experimental,
                price_timestamp=item.price_timestamp,
                notes=list(item.notes),
            )
            for item in plan.recommendations
        ],
    )


def _coverage_range_out(items):
    return [TranslationCoverageRangeOut(**item.__dict__) for item in items]


def _job_out(job: TranslationJob) -> TranslationJobOut:
    return TranslationJobOut(
        id=job.id,
        novel_id=job.novel_id,
        chapter_from=job.chapter_from,
        chapter_to=job.chapter_to,
        target_language=job.target_language,
        mode=job.mode,
        strategy=job.strategy,
        status=job.status,
        selected_model=job.selected_model,
        provider=job.provider,
        worker_count=job.worker_count,
        reuse_existing=job.reuse_existing,
        max_cost_usd=job.max_cost_usd,
        stats=TranslationJobStatsOut(
            selected_count=job.stats.selected_count,
            translated_count=job.stats.translated_count,
            reusable_count=job.stats.reusable_count,
            missing_count=job.stats.missing_count,
            stale_count=job.stats.stale_count,
            unknown_count=job.stats.unknown_count,
            estimated_savings_usd=job.stats.estimated_savings_usd,
            estimated_savings_brl=job.stats.estimated_savings_brl,
            estimated_cost_usd=job.stats.estimated_cost_usd,
            estimated_cost_brl=job.stats.estimated_cost_brl,
            actual_cost_usd=job.stats.actual_cost_usd,
            actual_cost_brl=job.stats.actual_cost_brl,
            estimated_remaining_cost_usd=job.stats.estimated_remaining_cost_usd,
            estimated_remaining_cost_brl=job.stats.estimated_remaining_cost_brl,
            average_cost_usd_per_chapter=job.stats.average_cost_usd_per_chapter,
            average_seconds_per_chapter=job.stats.average_seconds_per_chapter,
            elapsed_seconds=job.stats.elapsed_seconds,
            eta_seconds=job.stats.eta_seconds,
            retry_count=job.stats.retry_count,
            repair_count=job.stats.repair_count,
            failed_count=job.stats.failed_count,
            rate_limit_count=job.stats.rate_limit_count,
            effective_worker_count=job.stats.effective_worker_count,
            telemetry_reason=job.stats.telemetry_reason,
            progress_percent=job.stats.progress_percent,
            coverage_ranges=_coverage_range_out(job.stats.coverage_ranges),
        ),
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def _selection_record_out(record: AutomaticSelectionRecord) -> TranslationSelectionRecordOut:
    return TranslationSelectionRecordOut(
        id=record.id,
        job_id=record.job_id,
        novel_id=record.novel_id,
        chapter_from=record.chapter_from,
        chapter_to=record.chapter_to,
        target_language=record.target_language,
        mode=record.mode,
        winner_model=record.winner_model,
        winner_provider=record.winner_provider,
        editorial_grade_count=record.editorial_grade_count,
        editorial_cost_usd=record.editorial_cost_usd,
        sample_chapters=record.sample_chapters,
        trials=[TranslationSelectionTrialOut(**item.__dict__) for item in record.trials],
        created_at=record.created_at,
    )


def _memory_term_out(term: TranslationMemoryTerm) -> TranslationMemoryTermOut:
    return TranslationMemoryTermOut(**term.__dict__)


def _memory_conflict_out(conflict: MemoryConflict) -> TranslationMemoryConflictOut:
    return TranslationMemoryConflictOut(**conflict.__dict__)


def _memory_conflict_suggestion_out(suggestion: MemoryConflictSuggestion) -> TranslationMemoryConflictSuggestionOut:
    return TranslationMemoryConflictSuggestionOut(**suggestion.__dict__)


def _pricing_snapshot_out(snapshot: PricingSnapshot) -> TranslationPricingSnapshotOut:
    return TranslationPricingSnapshotOut(**snapshot.__dict__)


async def _ensure_fresh_pricing(
    db: AsyncSession,
    models: list[str],
) -> list[PricingSnapshot]:
    database = await load_pricing_snapshot_rows(db, limit=1000)
    merged = merge_pricing_snapshots(database, load_pricing_snapshots())
    if merged:
        save_pricing_snapshots(merged)
    missing = [model for model in models if not _has_fresh_model_price(merged, model)]
    providers = sorted(
        {
            provider
            for model in missing
            for provider in _pricing_providers_for_model(model)
        }
    )
    refresh_errors: list[str] = []
    refreshed: list[PricingSnapshot] = []
    for provider in providers:
        try:
            items = await asyncio.to_thread(
                refresh_openrouter_pricing_snapshot
                if provider == "openrouter"
                else refresh_direct_pricing_snapshot,
                *(() if provider == "openrouter" else (provider,)),
            )
            refreshed.extend(items)
        except Exception as exc:
            refresh_errors.append(f"{provider}: {type(exc).__name__}: {exc}")
    if refreshed:
        await upsert_pricing_snapshots(db, refreshed)
        await db.commit()
        database = await load_pricing_snapshot_rows(db, limit=1000)
        merged = merge_pricing_snapshots(database, load_pricing_snapshots())
        save_pricing_snapshots(merged)
    still_missing = [model for model in models if not _has_fresh_model_price(merged, model)]
    if still_missing:
        details = "; ".join(refresh_errors) or "nenhum preco reconhecido no catalogo"
        raise HTTPException(
            status_code=503,
            detail=f"pricing atualizado indisponivel para {', '.join(still_missing)} ({details})",
        )
    return merged


def _pricing_providers_for_model(model: str) -> set[str]:
    if "/" in model:
        return {"openrouter"}
    if model.startswith("gpt-"):
        return {"openai", "openrouter"}
    if model.startswith("deepseek-"):
        return {"deepseek", "openrouter"}
    if model.startswith("gemini-"):
        return {"gemini", "openrouter"}
    return {"openrouter"}


def _has_fresh_model_price(snapshots: list[PricingSnapshot], model: str) -> bool:
    now = datetime.now(timezone.utc)
    for snapshot in snapshots:
        aliases = {model}
        if "/" not in model:
            if model.startswith("gpt-"):
                aliases.add(f"openai/{model}")
            elif model.startswith("gemini-"):
                aliases.add(f"google/{model}")
            elif model.startswith("deepseek-"):
                aliases.add(f"deepseek/{model}")
        if snapshot.model not in aliases:
            continue
        try:
            expires_at = datetime.fromisoformat(snapshot.expires_at)
        except ValueError:
            continue
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at >= now:
            return True
    return False


async def _job_from_db_or_json(db: AsyncSession, job_id: str) -> TranslationJob | None:
    db_job = await get_job_row(db, job_id)
    json_job = get_translation_job(job_id)
    if db_job and json_job:
        return json_job if _job_updated_sort_key(json_job) >= _job_updated_sort_key(db_job) else db_job
    return db_job or json_job


async def _list_jobs_from_db_and_json(db: AsyncSession) -> list[TranslationJob]:
    merged = {job.id: job for job in load_translation_jobs()}
    for job in await list_job_rows(db):
        current = merged.get(job.id)
        if current is None or _job_updated_sort_key(job) > _job_updated_sort_key(current):
            merged[job.id] = job
    return sorted(merged.values(), key=_job_updated_sort_key, reverse=True)


async def _coverage_records_db_and_json(
    db: AsyncSession,
    *,
    novel_id: str | None = None,
    target_language: str | None = None,
):
    json_records = load_coverage_records()
    if novel_id:
        json_records = [item for item in json_records if item.novel_id == novel_id]
    if target_language:
        json_records = [item for item in json_records if item.target_language == target_language]
    db_records = await load_coverage_rows(db, novel_id=novel_id, target_language=target_language)
    return merge_coverage_records(json_records, db_records)


async def _memory_terms_db_and_json(
    db: AsyncSession,
    *,
    novel_id: str | None = None,
    status: str | None = None,
) -> list[TranslationMemoryTerm]:
    json_terms = load_memory_terms()
    if novel_id:
        json_terms = [item for item in json_terms if item.novel_id == novel_id]
    if status:
        json_terms = [item for item in json_terms if item.status == status]
    db_terms = await load_memory_term_rows(db, novel_id=novel_id, status=status)
    return merge_memory_terms(json_terms, db_terms)


async def _selection_records_db_and_json(
    db: AsyncSession,
    *,
    novel_id: str | None = None,
    target_language: str | None = None,
    limit: int = 100,
) -> list[AutomaticSelectionRecord]:
    json_records = load_selection_records()
    if novel_id:
        json_records = [item for item in json_records if item.novel_id == novel_id]
    if target_language:
        json_records = [item for item in json_records if item.target_language.lower() == target_language.lower()]
    db_records = await load_selection_rows(
        db,
        novel_id=novel_id,
        target_language=target_language,
        limit=limit,
    )
    return merge_selection_records(json_records, db_records)


def _job_updated_sort_key(job: TranslationJob) -> str:
    return job.updated_at or job.created_at or ""


async def _set_job_status_db_and_json(
    db: AsyncSession,
    job: TranslationJob,
    status: str,
    *,
    error: str = "",
) -> TranslationJob:
    try:
        json_updated = update_translation_job_status(job.id, status, error=error)
    except KeyError:
        upsert_translation_job(job)
        json_updated = update_translation_job_status(job.id, status, error=error)
    try:
        db_updated = await update_job_row_status(db, job.id, status, error=error)
    except KeyError:
        await upsert_job_row(db, json_updated)
        db_updated = json_updated
    await db.commit()
    return json_updated if _job_updated_sort_key(json_updated) >= _job_updated_sort_key(db_updated) else db_updated


async def _chapters_in_range(
    db: AsyncSession,
    *,
    novel_id: str,
    chapter_from: float,
    chapter_to: float | None,
) -> list[Chapter]:
    stmt = select(Chapter).where(Chapter.novel_id == novel_id).where(Chapter.number >= chapter_from)
    if chapter_to is not None:
        stmt = stmt.where(Chapter.number <= chapter_to)
    rows = (await db.scalars(stmt.order_by(Chapter.number))).all()
    return list(rows)


def _chapter_refs(rows: list[Chapter]) -> list[SourceChapterRef]:
    return [
        SourceChapterRef(
            id=chapter.id,
            number=float(chapter.number),
            content_path=chapter.content_path,
            content_hash=chapter.content_hash,
        )
        for chapter in rows
    ]


def _chapter_html_by_number(rows: list[Chapter]) -> dict[float, str]:
    html: dict[float, str] = {}
    for chapter in rows:
        if not chapter.content_path:
            continue
        try:
            html[float(chapter.number)] = storage.read_content(chapter.content_path)
        except FileNotFoundError:
            continue
    return html


async def _run_translation_job_background(
    job_id: str,
    *,
    allow_paid_providers: bool = False,
    allow_editorial_grader: bool = False,
) -> None:
    async def persist_job_progress(updated: TranslationJob) -> None:
        async with SessionLocal() as progress_db:
            await upsert_job_row(progress_db, updated)
            await progress_db.commit()

    async def persist_chapter_progress(record) -> None:
        async with SessionLocal() as progress_db:
            await upsert_coverage_row(progress_db, record)
            await progress_db.commit()

    async with SessionLocal() as lookup_db:
        job = await _job_from_db_or_json(lookup_db, job_id)
        if job is not None:
            memory = merge_memory_terms(
                await load_memory_term_rows(lookup_db, novel_id=job.novel_id),
                [item for item in load_memory_terms() if item.novel_id == job.novel_id],
            )
            upsert_memory_terms(memory)
            selection = merge_selection_records(
                await load_selection_rows(
                    lookup_db,
                    novel_id=job.novel_id,
                    target_language=job.target_language,
                    limit=1000,
                ),
                [item for item in load_selection_records() if item.novel_id == job.novel_id],
            )
            for record in selection:
                append_selection_record(record)
    if job is None:
        return
    if job.provider != "fake" and not allow_paid_providers:
        update_translation_job_status(
            job_id,
            "failed",
            error=f"provider {job.provider} requires allowPaidProviders=true",
        )
        async with SessionLocal() as fail_db:
            try:
                await update_job_row_status(
                    fail_db,
                    job_id,
                    "failed",
                    error=f"provider {job.provider} requires allowPaidProviders=true",
                )
                await fail_db.commit()
            except KeyError:
                await fail_db.rollback()
        return
    async with SessionLocal() as db:
        rows = await _chapters_in_range(
            db,
            novel_id=job.novel_id,
            chapter_from=job.chapter_from,
            chapter_to=job.chapter_to,
        )
    chapters: list[TranslationWorkChapter] = []
    for chapter in rows:
        if not chapter.content_path:
            continue
        try:
            html = storage.read_content(chapter.content_path)
        except FileNotFoundError:
            continue
        chapters.append(
            TranslationWorkChapter(
                id=chapter.id,
                number=float(chapter.number),
                html=html,
                content_hash=chapter.content_hash,
            )
        )
    result = await execute_translation_job(
        job,
        chapters,
        provider_for_job,
        editorial_grader_factory=_editorial_grader_factory() if allow_paid_providers and allow_editorial_grader else None,
        editorial_grader_models=_editorial_grader_models() if allow_paid_providers and allow_editorial_grader else None,
        on_job_update=persist_job_progress,
        on_chapter_update=persist_chapter_progress,
    )
    async with SessionLocal() as sync_db:
        await upsert_job_row(sync_db, result)
        coverage_records = [
            item
            for item in load_coverage_records()
            if item.novel_id == result.novel_id and item.target_language == result.target_language and item.origin == "job"
        ]
        await upsert_coverage_rows(sync_db, coverage_records)
        memory_terms = [item for item in load_memory_terms() if item.novel_id == result.novel_id]
        await upsert_memory_term_rows(sync_db, memory_terms)
        selection_records = [item for item in load_selection_records() if item.job_id == result.id]
        await upsert_selection_rows(sync_db, selection_records)
        await sync_db.commit()


def _editorial_grader_models() -> list[str]:
    raw = os.getenv("OGHMA_TRANSLATION_GRADER_MODELS", "gpt-5.4-mini")
    return [item.strip() for item in raw.split(",") if item.strip()]


def _editorial_grader_factory():
    reasoning = os.getenv("OGHMA_TRANSLATION_GRADER_REASONING", "low")

    def factory(model: str):
        return OpenAIProvider.from_env(model=model, reasoning_effort=reasoning)

    return factory


@router.get("/translations/coverage", response_model=TranslationCoverageOut)
async def translation_coverage(
    novelId: str,
    chapterFrom: float = 1,
    chapterTo: float | None = None,
    targetLanguage: str = "pt-BR",
    mode: str = "balanced",
    usdBrlRate: float | None = None,
    db: AsyncSession = Depends(get_db),
):
    if chapterTo is not None and chapterTo < chapterFrom:
        raise HTTPException(status_code=400, detail="intervalo de capitulos invalido")
    rows = await _chapters_in_range(db, novel_id=novelId, chapter_from=chapterFrom, chapter_to=chapterTo)
    if not rows:
        raise HTTPException(status_code=404, detail="nenhum capitulo encontrado no intervalo")

    coverage = build_coverage(
        _chapter_refs(rows),
        await _coverage_records_db_and_json(db, novel_id=novelId, target_language=targetLanguage),
        novel_id=novelId,
        target_language=targetLanguage,
        usd_brl_rate=usdBrlRate,
        mode=mode,
        source_html_by_number=_chapter_html_by_number(rows),
    )
    return TranslationCoverageOut(
        novel_id=novelId,
        chapter_from=chapterFrom,
        chapter_to=chapterTo if chapterTo is not None else float(rows[-1].number),
        target_language=targetLanguage,
        selected_count=coverage.selected_count,
        translated_count=coverage.translated_count,
        missing_count=coverage.missing_count,
        stale_count=coverage.stale_count,
        unknown_count=coverage.unknown_count,
        coverage_percent=coverage.coverage_percent,
        ranges=_coverage_range_out(coverage.ranges),
        stale_ranges=_coverage_range_out(coverage.stale_ranges),
        unknown_ranges=_coverage_range_out(coverage.unknown_ranges),
        estimated_savings_usd=coverage.estimated_savings_usd,
        estimated_savings_brl=coverage.estimated_savings_brl,
    )


@router.post("/translations/automatic-plan", response_model=TranslationAutomaticPlanOut)
async def translation_automatic_plan(
    request: TranslationAutomaticPlanRequest,
    db: AsyncSession = Depends(get_db),
):
    if request.chapter_to < request.chapter_from:
        raise HTTPException(status_code=400, detail="intervalo de capitulos invalido")
    rows = await _chapters_in_range(
        db,
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="nenhum capitulo encontrado no intervalo")
    html_by_number = _chapter_html_by_number(rows)
    candidates = [
        CandidateChapter(
            id=chapter.id,
            number=float(chapter.number),
            html=html_by_number[float(chapter.number)],
            word_count=chapter.word_count,
        )
        for chapter in rows
        if float(chapter.number) in html_by_number
    ]
    if not candidates:
        raise HTTPException(status_code=404, detail="nenhum capitulo baixado encontrado no intervalo")
    candidate_models = request.candidate_models or await _historical_candidate_models_db_and_json(
        db,
        request.novel_id,
    )
    await _ensure_fresh_pricing(
        db,
        [*candidate_models, *(request.grader_models or _editorial_grader_models())],
    )
    plan = build_automatic_selection_plan(
        candidates,
        mode=request.mode,
        candidate_models=candidate_models,
        usd_brl_rate=request.usd_brl_rate,
        max_samples=request.max_samples,
        max_models=request.max_models,
        grader_models=request.grader_models or _editorial_grader_models(),
    )
    return TranslationAutomaticPlanOut(
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
        mode=request.mode,
        sample_chapters=[TranslationAutomaticSampleOut(**item.__dict__) for item in plan.sample_chapters],
        candidate_models=plan.candidate_models,
        estimated_sample_usd=plan.estimated_sample_usd,
        estimated_sample_brl=plan.estimated_sample_brl,
        estimated_editorial_grader_usd=plan.estimated_editorial_grader_usd,
        estimated_editorial_grader_brl=plan.estimated_editorial_grader_brl,
        recommendations=[
            TranslationModelRecommendationOut(
                model=item.model,
                estimated_usd=item.estimated_usd,
                estimated_brl=item.estimated_brl,
                estimated_duration_seconds=item.estimated_duration_seconds,
                quality_score=item.quality_score,
                gate_pass_rate=item.gate_pass_rate,
                recommendation_score=item.recommendation_score,
                experimental=item.experimental,
                price_timestamp=item.price_timestamp,
                notes=list(item.notes),
            )
            for item in plan.recommendations
        ],
    )


@router.get("/translations/selection-history", response_model=list[TranslationSelectionRecordOut])
async def translation_selection_history(
    novelId: str | None = None,
    targetLanguage: str | None = None,
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    records = await _selection_records_db_and_json(
        db,
        novel_id=novelId,
        target_language=targetLanguage,
        limit=limit,
    )
    return [_selection_record_out(item) for item in records[:limit]]


@router.get("/translations/memory", response_model=list[TranslationMemoryTermOut])
async def translation_memory(
    novelId: str | None = None,
    status: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    terms = await _memory_terms_db_and_json(db, novel_id=novelId, status=status)
    return [_memory_term_out(item) for item in terms[:limit]]


@router.get("/translations/memory/conflicts", response_model=list[TranslationMemoryConflictOut])
async def translation_memory_conflicts(
    novelId: str,
    severity: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    conflicts = detect_memory_conflicts_from_terms(novelId, await _memory_terms_db_and_json(db, novel_id=novelId))
    if severity:
        conflicts = [item for item in conflicts if item.severity == severity]
    return [_memory_conflict_out(item) for item in conflicts[:limit]]


@router.get("/translations/memory/conflict-suggestions", response_model=list[TranslationMemoryConflictSuggestionOut])
async def translation_memory_conflict_suggestions(
    novelId: str,
    action: str | None = None,
    limit: int = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    suggestions = suggest_memory_conflict_resolutions_from_terms(
        novelId,
        await _memory_terms_db_and_json(db, novel_id=novelId),
    )
    if action:
        suggestions = [item for item in suggestions if item.action == action]
    return [_memory_conflict_suggestion_out(item) for item in suggestions[:limit]]


@router.post("/translations/memory/conflicts/resolve", response_model=TranslationMemoryConflictResolveOut)
async def resolve_translation_memory_conflict(
    request: TranslationMemoryConflictResolveRequest,
    db: AsyncSession = Depends(get_db),
):
    source = request.source.strip()
    target = request.target.strip()
    if not source or not target:
        raise HTTPException(status_code=400, detail="source e target sao obrigatorios")
    term = upsert_manual_memory_term(
        novel_id=request.novel_id,
        source=source,
        target=target,
        status="locked",
        category="manual",
        notes="Resolvido a partir de alerta do glossario.",
    )
    term = await upsert_memory_term_row(db, term)
    await db.commit()
    post_edit = None
    if request.apply_existing:
        post_edit = apply_replacements_to_coverage(
            novel_id=request.novel_id,
            target_language=request.target_language,
            terms=[ReplacementTerm(source=source, target=target)],
        )
    remaining = len(detect_memory_conflicts_from_terms(
        request.novel_id,
        await _memory_terms_db_and_json(db, novel_id=request.novel_id),
    ))
    return TranslationMemoryConflictResolveOut(
        term=_memory_term_out(term),
        post_edit=TranslationPostEditResultOut(**post_edit.__dict__) if post_edit else None,
        remaining_conflict_count=remaining,
    )


@router.post("/translations/memory/terms", response_model=TranslationMemoryTermUpsertOut)
async def upsert_translation_memory_term(
    request: TranslationMemoryTermUpsertRequest,
    db: AsyncSession = Depends(get_db),
):
    source = request.source.strip()
    target = request.target.strip()
    if not source or not target:
        raise HTTPException(status_code=400, detail="source e target sao obrigatorios")
    term = upsert_manual_memory_term(
        novel_id=request.novel_id,
        source=source,
        target=target,
        status=request.status,
        category=request.category,
        notes=request.notes,
    )
    term = await upsert_memory_term_row(db, term)
    await db.commit()
    post_edit = None
    if request.apply_existing:
        post_edit = apply_replacements_to_coverage(
            novel_id=request.novel_id,
            target_language=request.target_language,
            terms=[ReplacementTerm(source=source, target=target)],
        )
    return TranslationMemoryTermUpsertOut(
        term=_memory_term_out(term),
        post_edit=TranslationPostEditResultOut(**post_edit.__dict__) if post_edit else None,
    )


@router.get("/translations/pricing", response_model=list[TranslationPricingSnapshotOut])
async def translation_pricing(
    provider: str | None = None,
    model: str | None = None,
    limit: int = Query(200, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
):
    database = await load_pricing_snapshot_rows(
        db,
        provider=provider,
        model=model,
        limit=limit,
    )
    snapshots = merge_pricing_snapshots(database, load_pricing_snapshots())
    if provider:
        snapshots = [item for item in snapshots if item.provider == provider]
    if model:
        snapshots = [item for item in snapshots if item.model == model]
    return [_pricing_snapshot_out(item) for item in snapshots[:limit]]


@router.post("/translations/pricing/refresh", response_model=TranslationPricingRefreshOut)
async def refresh_translation_pricing(
    provider: str = "openrouter",
    db: AsyncSession = Depends(get_db),
):
    if provider not in {"openrouter", "openai", "deepseek", "gemini"}:
        raise HTTPException(status_code=400, detail="provider de pricing nao suportado")
    try:
        snapshots = await asyncio.to_thread(
            refresh_openrouter_pricing_snapshot
            if provider == "openrouter"
            else refresh_direct_pricing_snapshot,
            *(() if provider == "openrouter" else (provider,)),
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"falha ao atualizar pricing: {type(exc).__name__}: {exc}")
    await upsert_pricing_snapshots(db, snapshots)
    await db.commit()
    return TranslationPricingRefreshOut(
        provider=provider,
        updated_count=len(snapshots),
        snapshots=[_pricing_snapshot_out(item) for item in snapshots[:50]],
    )


def _historical_candidate_models(novel_id: str, target_language: str = "pt-BR") -> list[str]:
    historical = winning_models_for_novel(novel_id, target_language=target_language)
    return [*historical, *[model for model in DEFAULT_TRANSLATION_MODELS if model not in historical]]


async def _historical_candidate_models_db_and_json(
    db: AsyncSession,
    novel_id: str,
    target_language: str = "pt-BR",
) -> list[str]:
    records = merge_selection_records(
        await load_selection_rows(
            db,
            novel_id=novel_id,
            target_language=target_language,
            limit=1000,
        ),
        [
            item
            for item in load_selection_records()
            if item.novel_id == novel_id and item.target_language.lower() == target_language.lower()
        ],
    )
    historical: list[str] = []
    for record in records:
        if record.winner_model not in historical:
            historical.append(record.winner_model)
        if len(historical) >= 3:
            break
    return [*historical, *[model for model in DEFAULT_TRANSLATION_MODELS if model not in historical]]


def _estimate_job_cost(
    request: TranslationJobCreateRequest,
    rows: list[Chapter],
    source_html_by_number: dict[float, str],
    automatic_candidate_models: list[str] | None = None,
) -> tuple[float, float | None]:
    if not source_html_by_number:
        return 0.0, None
    chapter_html = list(source_html_by_number.values())
    if request.strategy == "automatic" or request.selected_model == "automatic":
        candidates = [
            CandidateChapter(
                id=chapter.id,
                number=float(chapter.number),
                html=source_html_by_number[float(chapter.number)],
                word_count=chapter.word_count,
            )
            for chapter in rows
            if float(chapter.number) in source_html_by_number
        ]
        automatic_plan = build_automatic_selection_plan(
            candidates,
            mode=request.mode,
            candidate_models=automatic_candidate_models
            or _historical_candidate_models(request.novel_id, request.target_language),
            usd_brl_rate=request.usd_brl_rate,
            max_samples=4,
            max_models=4,
            grader_models=_editorial_grader_models(),
        )
        full_plan = build_translation_plan(
            chapter_html,
            mode=request.mode,
            models=automatic_plan.candidate_models,
            usd_brl_rate=request.usd_brl_rate,
        )
        recommendation = full_plan.recommendations[0] if full_plan.recommendations else None
        estimated_usd = (recommendation.estimated_usd if recommendation else 0.0) + automatic_plan.estimated_sample_usd
        estimated_brl = (
            (recommendation.estimated_brl or 0.0) + (automatic_plan.estimated_sample_brl or 0.0)
            if request.usd_brl_rate
            else None
        )
        return round(estimated_usd, 6), round(estimated_brl, 6) if estimated_brl is not None else None
    plan = build_translation_plan(
        chapter_html,
        mode=request.mode,
        models=[request.selected_model],
        usd_brl_rate=request.usd_brl_rate,
    )
    recommendation = plan.recommendations[0] if plan.recommendations else None
    return (
        recommendation.estimated_usd if recommendation else 0.0,
        recommendation.estimated_brl if recommendation else None,
    )


@router.post("/translations/jobs", response_model=TranslationJobOut)
async def create_translation_job_route(
    request: TranslationJobCreateRequest,
    db: AsyncSession = Depends(get_db),
):
    if request.chapter_to < request.chapter_from:
        raise HTTPException(status_code=400, detail="intervalo de capitulos invalido")
    rows = await _chapters_in_range(
        db,
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
    )
    if not rows:
        raise HTTPException(status_code=404, detail="nenhum capitulo encontrado no intervalo")
    automatic_candidates = (
        await _historical_candidate_models_db_and_json(db, request.novel_id, request.target_language)
        if request.strategy == "automatic" or request.selected_model == "automatic"
        else []
    )
    pricing_models = (
        [*automatic_candidates, *_editorial_grader_models()]
        if automatic_candidates
        else [request.selected_model]
    )
    await _ensure_fresh_pricing(db, pricing_models)
    source_html_by_number = _chapter_html_by_number(rows)
    coverage = build_coverage(
        _chapter_refs(rows),
        await _coverage_records_db_and_json(db, novel_id=request.novel_id, target_language=request.target_language),
        novel_id=request.novel_id,
        target_language=request.target_language,
        usd_brl_rate=request.usd_brl_rate,
        mode=request.mode,
        source_html_by_number=source_html_by_number,
    )
    estimated_cost_usd, estimated_cost_brl = _estimate_job_cost(
        request,
        rows,
        source_html_by_number,
        automatic_candidate_models=automatic_candidates,
    )
    job = create_translation_job(
        novel_id=request.novel_id,
        chapter_from=request.chapter_from,
        chapter_to=request.chapter_to,
        target_language=request.target_language,
        mode=request.mode,
        strategy=request.strategy,
        selected_model=request.selected_model,
        provider=request.provider,
        worker_count=request.worker_count,
        reuse_existing=request.reuse_existing,
        max_cost_usd=request.max_cost_usd,
        coverage=coverage,
        estimated_cost_usd=estimated_cost_usd,
        estimated_cost_brl=estimated_cost_brl,
    )
    await upsert_job_row(db, job)
    await db.commit()
    return _job_out(job)


@router.get("/translations/jobs", response_model=list[TranslationJobOut])
async def list_translation_jobs(db: AsyncSession = Depends(get_db)):
    return [_job_out(job) for job in await _list_jobs_from_db_and_json(db)]


@router.get("/translations/jobs/{job_id}", response_model=TranslationJobOut)
async def get_translation_job_route(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _job_from_db_or_json(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job de traducao nao encontrado")
    return _job_out(job)


@router.post("/translations/jobs/{job_id}/pause", response_model=TranslationJobOut)
async def pause_translation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _job_from_db_or_json(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job de traducao nao encontrado")
    return _job_out(await _set_job_status_db_and_json(db, job, "paused"))


@router.post("/translations/jobs/{job_id}/resume", response_model=TranslationJobOut)
async def resume_translation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _job_from_db_or_json(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job de traducao nao encontrado")
    return _job_out(await _set_job_status_db_and_json(db, job, "queued"))


@router.post("/translations/jobs/{job_id}/cancel", response_model=TranslationJobOut)
async def cancel_translation_job(job_id: str, db: AsyncSession = Depends(get_db)):
    job = await _job_from_db_or_json(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job de traducao nao encontrado")
    return _job_out(await _set_job_status_db_and_json(db, job, "cancelled"))


@router.post("/translations/jobs/{job_id}/run", response_model=TranslationJobOut)
async def run_translation_job(
    job_id: str,
    background: BackgroundTasks,
    allowPaidProviders: bool = False,
    allowEditorialGrader: bool = False,
    db: AsyncSession = Depends(get_db),
):
    job = await _job_from_db_or_json(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="job de traducao nao encontrado")
    if job.status not in {"queued", "paused"}:
        raise HTTPException(status_code=409, detail="job nao esta pronto para executar")
    if job.provider != "fake" and not allowPaidProviders:
        raise HTTPException(status_code=400, detail="provider pago exige allowPaidProviders=true")
    if job.max_cost_usd is not None and job.stats.estimated_cost_usd > job.max_cost_usd:
        raise HTTPException(
            status_code=400,
            detail=(
                f"estimativa ${job.stats.estimated_cost_usd:.6f} excede "
                f"orcamento ${job.max_cost_usd:.6f}"
            ),
        )
    updated = await _set_job_status_db_and_json(db, job, "planning")
    background.add_task(
        _run_translation_job_background,
        job_id,
        allow_paid_providers=allowPaidProviders,
        allow_editorial_grader=allowEditorialGrader,
    )
    return _job_out(updated)


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
async def publish_run(background: BackgroundTasks, source: str = "all"):
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
