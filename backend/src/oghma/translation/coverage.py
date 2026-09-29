"""Coverage helpers for reusable translated chapters."""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

from ..config import get_settings
from .json_index import mutate_json_index, read_json_index, write_json_index
from .planner import build_translation_plan

REUSABLE_STATUSES = {"approved_auto", "translated", "done"}


@dataclass(frozen=True)
class TranslationChapterRecord:
    novel_id: str
    chapter_number: float
    chapter_id: str = ""
    target_language: str = "pt-BR"
    status: str = "approved_auto"
    translated_path: str = ""
    sidecar_path: str = ""
    source_hash: str | None = None
    translated_hash: str | None = None
    model: str = ""
    provider: str = ""
    quality_score: float | None = None
    public_reusable: bool = True
    origin: str = "local"
    updated_at: str = ""

    @property
    def is_reusable(self) -> bool:
        return self.public_reusable and self.status in REUSABLE_STATUSES


@dataclass(frozen=True)
class SourceChapterRef:
    id: str
    number: float
    content_path: str | None = None
    content_hash: str | None = None


@dataclass(frozen=True)
class CoverageRange:
    start: float
    end: float
    count: int
    freshness: str = "fresh"


@dataclass(frozen=True)
class TranslationCoverage:
    selected_count: int
    translated_count: int
    missing_count: int
    stale_count: int
    unknown_count: int
    coverage_percent: float
    ranges: list[CoverageRange]
    stale_ranges: list[CoverageRange]
    unknown_ranges: list[CoverageRange]
    estimated_savings_usd: float
    estimated_savings_brl: float | None = None


def default_coverage_index_path() -> Path:
    raw = os.getenv("OGHMA_TRANSLATION_COVERAGE_INDEX")
    if raw:
        return Path(raw)
    return Path(get_settings().storage_root) / "translations" / "coverage-index.json"


def load_coverage_records(path: Path | None = None) -> list[TranslationChapterRecord]:
    index_path = path or default_coverage_index_path()
    if not index_path.exists():
        return []
    raw = read_json_index(index_path)
    return _coverage_records_from_raw(raw)


def _coverage_records_from_raw(raw: object) -> list[TranslationChapterRecord]:
    raw_records = raw.get("chapters", []) if isinstance(raw, dict) else raw
    if not isinstance(raw_records, list):
        raise ValueError("translation coverage index must be a list or an object with chapters[]")
    records: list[TranslationChapterRecord] = []
    for item in raw_records:
        if not isinstance(item, dict):
            continue
        records.append(
            TranslationChapterRecord(
                novel_id=str(item["novel_id"]),
                chapter_id=str(item.get("chapter_id", "")),
                chapter_number=float(item["chapter_number"]),
                target_language=str(item.get("target_language", "pt-BR")),
                status=str(item.get("status", "approved_auto")),
                translated_path=str(item.get("translated_path", "")),
                sidecar_path=str(item.get("sidecar_path", "")),
                source_hash=str(item["source_hash"]) if item.get("source_hash") else None,
                translated_hash=str(item["translated_hash"]) if item.get("translated_hash") else None,
                model=str(item.get("model", "")),
                provider=str(item.get("provider", "")),
                quality_score=float(item["quality_score"]) if item.get("quality_score") is not None else None,
                public_reusable=bool(item.get("public_reusable", True)),
                origin=str(item.get("origin", "local")),
                updated_at=str(item.get("updated_at", "")),
            )
        )
    return records


def save_coverage_records(records: list[TranslationChapterRecord], path: Path | None = None) -> None:
    index_path = path or default_coverage_index_path()
    payload = {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "chapters": [_record_payload(record) for record in sorted(records, key=_record_sort_key)],
    }
    write_json_index(index_path, payload)


def upsert_coverage_record(record: TranslationChapterRecord, path: Path | None = None) -> None:
    index_path = path or default_coverage_index_path()
    updated = record
    if not updated.updated_at:
        updated = TranslationChapterRecord(**{**asdict(updated), "updated_at": datetime.now(timezone.utc).isoformat()})

    def mutate(raw: object) -> object:
        key = _record_key(updated)
        records = [item for item in _coverage_records_from_raw(raw) if _record_key(item) != key]
        records.append(updated)
        return {
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "chapters": [_record_payload(item) for item in sorted(records, key=_record_sort_key)],
        }

    mutate_json_index(index_path, mutate)


def build_coverage(
    source_chapters: list[SourceChapterRef],
    records: Iterable[TranslationChapterRecord],
    *,
    novel_id: str,
    target_language: str = "pt-BR",
    usd_brl_rate: float | None = None,
    mode: str = "balanced",
    source_html_by_number: dict[float, str] | None = None,
) -> TranslationCoverage:
    record_by_number = {
        record.chapter_number: record
        for record in records
        if record.novel_id == novel_id and record.target_language == target_language and record.is_reusable
    }
    fresh: list[float] = []
    stale: list[float] = []
    unknown: list[float] = []
    for chapter in source_chapters:
        record = record_by_number.get(chapter.number)
        if record is None:
            continue
        freshness = _freshness(chapter, record)
        if freshness == "fresh":
            fresh.append(chapter.number)
        elif freshness == "stale":
            stale.append(chapter.number)
        else:
            unknown.append(chapter.number)

    selected_count = len(source_chapters)
    translated_count = len(fresh) + len(stale) + len(unknown)
    savings_usd = _estimate_savings(
        reusable_numbers=[*fresh, *unknown],
        source_html_by_number=source_html_by_number or {},
        usd_brl_rate=usd_brl_rate,
        mode=mode,
    )
    return TranslationCoverage(
        selected_count=selected_count,
        translated_count=translated_count,
        missing_count=max(0, selected_count - translated_count),
        stale_count=len(stale),
        unknown_count=len(unknown),
        coverage_percent=round((translated_count / selected_count) * 100, 3) if selected_count else 0.0,
        ranges=_compress_ranges(fresh),
        stale_ranges=_compress_ranges(stale, freshness="stale"),
        unknown_ranges=_compress_ranges(unknown, freshness="unknown"),
        estimated_savings_usd=savings_usd,
        estimated_savings_brl=round(savings_usd * usd_brl_rate, 6) if usd_brl_rate else None,
    )


def _freshness(chapter: SourceChapterRef, record: TranslationChapterRecord) -> str:
    if not chapter.content_hash or not record.source_hash:
        return "unknown"
    return "fresh" if chapter.content_hash == record.source_hash else "stale"


def _record_key(record: TranslationChapterRecord) -> tuple[str, str, float]:
    return (record.novel_id, record.target_language, record.chapter_number)


def _record_sort_key(record: TranslationChapterRecord) -> tuple[str, str, float]:
    return (record.novel_id, record.target_language, record.chapter_number)


def _record_payload(record: TranslationChapterRecord) -> dict[str, object]:
    return {
        "novel_id": record.novel_id,
        "chapter_id": record.chapter_id,
        "chapter_number": record.chapter_number,
        "target_language": record.target_language,
        "status": record.status,
        "translated_path": record.translated_path,
        "sidecar_path": record.sidecar_path,
        "source_hash": record.source_hash,
        "translated_hash": record.translated_hash,
        "model": record.model,
        "provider": record.provider,
        "quality_score": record.quality_score,
        "public_reusable": record.public_reusable,
        "origin": record.origin,
        "updated_at": record.updated_at,
    }


def translation_chapter_record_payload(record: TranslationChapterRecord) -> dict[str, object]:
    return _record_payload(record)


def translation_chapter_record_from_payload(payload: dict) -> TranslationChapterRecord:
    return TranslationChapterRecord(
        novel_id=str(payload["novel_id"]),
        chapter_id=str(payload.get("chapter_id", "")),
        chapter_number=float(payload["chapter_number"]),
        target_language=str(payload.get("target_language", "pt-BR")),
        status=str(payload.get("status", "approved_auto")),
        translated_path=str(payload.get("translated_path", "")),
        sidecar_path=str(payload.get("sidecar_path", "")),
        source_hash=str(payload["source_hash"]) if payload.get("source_hash") else None,
        translated_hash=str(payload["translated_hash"]) if payload.get("translated_hash") else None,
        model=str(payload.get("model", "")),
        provider=str(payload.get("provider", "")),
        quality_score=float(payload["quality_score"]) if payload.get("quality_score") is not None else None,
        public_reusable=bool(payload.get("public_reusable", True)),
        origin=str(payload.get("origin", "local")),
        updated_at=str(payload.get("updated_at", "")),
    )


def _estimate_savings(
    *,
    reusable_numbers: list[float],
    source_html_by_number: dict[float, str],
    usd_brl_rate: float | None,
    mode: str,
) -> float:
    html = [source_html_by_number[number] for number in reusable_numbers if number in source_html_by_number]
    if not html:
        return 0.0
    plan = build_translation_plan(html, mode=mode, usd_brl_rate=usd_brl_rate)
    if not plan.recommendations:
        return 0.0
    return plan.recommendations[0].estimated_usd


def _compress_ranges(numbers: list[float], *, freshness: str = "fresh") -> list[CoverageRange]:
    ordered = sorted(set(numbers))
    if not ordered:
        return []
    ranges: list[CoverageRange] = []
    start = previous = ordered[0]
    count = 1
    for number in ordered[1:]:
        if number == previous + 1:
            previous = number
            count += 1
            continue
        ranges.append(CoverageRange(start=start, end=previous, count=count, freshness=freshness))
        start = previous = number
        count = 1
    ranges.append(CoverageRange(start=start, end=previous, count=count, freshness=freshness))
    return ranges
