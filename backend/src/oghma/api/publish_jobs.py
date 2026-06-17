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
        )
        return True, snapshot()


async def run_publish(source_id: str) -> None:
    from ..config import get_settings
    from ..publish.runner import run

    settings = get_settings()
    out_dir = str(Path(settings.storage_root) / "publish")
    try:
        summary = await run(source_id, out_dir=out_dir)
    except Exception as exc:  # noqa: BLE001 - surfaced in monitor for operation
        async with _lock:
            _state.update(status="error", error=repr(exc), finishedAt=time.time())
    else:
        async with _lock:
            _state.update(status="done", summary=summary, error=None, finishedAt=time.time())


async def reset_for_tests() -> None:
    async with _lock:
        _state.update(
            status="idle",
            source=None,
            startedAt=None,
            finishedAt=None,
            summary=None,
            error=None,
        )
