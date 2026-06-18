from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any

_state: dict[str, Any] = {
    "status": "idle",
    "source": None,
    "startedAt": None,
    "finishedAt": None,
    "summary": None,
    "error": None,
    "phase": None,
    "currentSource": None,
    "sourcesDone": 0,
    "sourcesTotal": 0,
}
_lock = asyncio.Lock()


def snapshot() -> dict[str, Any]:
    return dict(_state)


async def start_publish(source_id: str) -> tuple[bool, dict[str, Any]]:
    async with _lock:
        if _state["status"] == "running":
            return False, snapshot()
        _state.update(
            status="running",
            source=source_id,
            startedAt=time.time(),
            finishedAt=None,
            summary=None,
            error=None,
            phase="preparing",
            currentSource=None,
            sourcesDone=0,
            sourcesTotal=0,
        )
        return True, snapshot()


async def _publishable_sources() -> list[str]:
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Novel, SourceSite

    async with SessionLocal() as session:
        rows = (
            await session.execute(
                select(SourceSite.id)
                .join(Novel, Novel.source_id == SourceSite.id)
                .where(SourceSite.enabled.is_(True))
                .distinct()
                .order_by(SourceSite.id)
            )
        ).scalars().all()
    return list(rows)


def _combine_summaries(results: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "sources": results,
        "source_count": len(results),
        "novels": sum(int(item["summary"].get("novels") or 0) for item in results),
        "bundles_changed": sum(int(item["summary"].get("bundles_changed") or 0) for item in results),
        "covers": sum(int(item["summary"].get("covers") or 0) for item in results),
        "missing_covers": sum(int(item["summary"].get("missing_covers") or 0) for item in results),
        "uploaded": all(bool(item["summary"].get("uploaded")) for item in results),
    }


async def run_publish(source_id: str) -> None:
    from ..config import get_settings
    from ..publish.runner import run

    settings = get_settings()
    out_dir = str(Path(settings.storage_root) / "publish")
    try:
        if source_id == "all":
            source_ids = await _publishable_sources()
            if not source_ids:
                raise RuntimeError("nenhuma fonte com novels para publicar")
            results = []
            _state.update(sourcesTotal=len(source_ids))
            for index, current_source in enumerate(source_ids):
                _state.update(currentSource=current_source, sourcesDone=index, phase="building")
                summary = await run(
                    current_source,
                    out_dir=out_dir,
                    progress=lambda update: _state.update(update),
                )
                results.append({"source": current_source, "summary": summary})
                _state.update(sourcesDone=index + 1)
            summary = _combine_summaries(results)
        else:
            _state.update(currentSource=source_id, sourcesTotal=1)
            summary = await run(
                source_id,
                out_dir=out_dir,
                progress=lambda update: _state.update(update),
            )
            _state.update(sourcesDone=1)
    except Exception as exc:  # noqa: BLE001 - surfaced in monitor for operation
        async with _lock:
            _state.update(status="error", phase="error", error=repr(exc), finishedAt=time.time())
    else:
        async with _lock:
            _state.update(status="done", phase="done", summary=summary, error=None, finishedAt=time.time())


async def reset_for_tests() -> None:
    async with _lock:
        _state.update(
            status="idle",
            source=None,
            startedAt=None,
            finishedAt=None,
            summary=None,
            error=None,
            phase=None,
            currentSource=None,
            sourcesDone=0,
            sourcesTotal=0,
        )
