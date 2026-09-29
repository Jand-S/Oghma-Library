"""Persistent history for automatic translation model selection."""
from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from ..config import get_settings
from .json_index import mutate_json_index, read_json_index, write_json_index


@dataclass(frozen=True)
class AutomaticSelectionTrialSummary:
    model: str
    provider: str
    average_score: float
    total_cost_usd: float
    total_duration_seconds: float
    failure_count: int


@dataclass(frozen=True)
class AutomaticSelectionRecord:
    id: str
    job_id: str
    novel_id: str
    chapter_from: float
    chapter_to: float
    target_language: str
    mode: str
    winner_model: str
    winner_provider: str
    editorial_grade_count: int = 0
    editorial_cost_usd: float = 0.0
    sample_chapters: list[float] = field(default_factory=list)
    trials: list[AutomaticSelectionTrialSummary] = field(default_factory=list)
    created_at: str = ""


def default_selection_history_path() -> Path:
    raw = os.getenv("OGHMA_TRANSLATION_SELECTION_HISTORY")
    if raw:
        return Path(raw)
    return Path(get_settings().storage_root) / "translations" / "selection-history.json"


def append_selection_record(record: AutomaticSelectionRecord, path: Path | None = None) -> None:
    index_path = path or default_selection_history_path()

    def mutate(raw: object) -> object:
        records = [item for item in _selection_records_from_raw(raw) if item.id != record.id]
        records.append(record)
        return _selection_records_payload(records)

    mutate_json_index(index_path, mutate)


def load_selection_records(path: Path | None = None) -> list[AutomaticSelectionRecord]:
    index_path = path or default_selection_history_path()
    if not index_path.exists():
        return []
    raw = read_json_index(index_path)
    return _selection_records_from_raw(raw)


def _selection_records_from_raw(raw: object) -> list[AutomaticSelectionRecord]:
    raw_records = raw.get("records", []) if isinstance(raw, dict) else raw
    if not isinstance(raw_records, list):
        raise ValueError("selection history index must be a list or an object with records[]")
    return [_record_from_payload(item) for item in raw_records if isinstance(item, dict)]


def save_selection_records(records: list[AutomaticSelectionRecord], path: Path | None = None) -> None:
    index_path = path or default_selection_history_path()
    write_json_index(index_path, _selection_records_payload(records))


def _selection_records_payload(records: list[AutomaticSelectionRecord]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "records": [asdict(item) for item in sorted(records, key=lambda item: item.created_at, reverse=True)],
    }


def winning_models_for_novel(
    novel_id: str,
    *,
    target_language: str | None = None,
    limit: int = 3,
    path: Path | None = None,
) -> list[str]:
    winners: list[str] = []
    for record in load_selection_records(path):
        if record.novel_id != novel_id:
            continue
        if target_language and record.target_language.lower() != target_language.lower():
            continue
        if record.winner_model in winners:
            continue
        winners.append(record.winner_model)
        if len(winners) >= limit:
            break
    return winners


def _record_from_payload(payload: dict) -> AutomaticSelectionRecord:
    return AutomaticSelectionRecord(
        id=str(payload["id"]),
        job_id=str(payload["job_id"]),
        novel_id=str(payload["novel_id"]),
        chapter_from=float(payload["chapter_from"]),
        chapter_to=float(payload["chapter_to"]),
        target_language=str(payload.get("target_language", "pt-BR")),
        mode=str(payload.get("mode", "balanced")),
        winner_model=str(payload["winner_model"]),
        winner_provider=str(payload.get("winner_provider", "")),
        editorial_grade_count=int(payload.get("editorial_grade_count", 0)),
        editorial_cost_usd=float(payload.get("editorial_cost_usd", 0.0)),
        sample_chapters=[float(item) for item in payload.get("sample_chapters", [])],
        trials=[
            AutomaticSelectionTrialSummary(
                model=str(item["model"]),
                provider=str(item.get("provider", "")),
                average_score=float(item.get("average_score", 0.0)),
                total_cost_usd=float(item.get("total_cost_usd", 0.0)),
                total_duration_seconds=float(item.get("total_duration_seconds", 0.0)),
                failure_count=int(item.get("failure_count", 0)),
            )
            for item in payload.get("trials", [])
            if isinstance(item, dict)
        ],
        created_at=str(payload.get("created_at", "")),
    )


def automatic_selection_record_from_payload(payload: dict) -> AutomaticSelectionRecord:
    return _record_from_payload(payload)


def automatic_selection_record_payload(record: AutomaticSelectionRecord) -> dict[str, object]:
    return asdict(record)
