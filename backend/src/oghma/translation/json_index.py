"""Small locked JSON index helpers for translation MVP persistence."""
from __future__ import annotations

import json
import os
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator


def read_json_index(path: Path) -> object:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def write_json_index(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with locked_index(path):
        _write_json_unlocked(path, payload)


def mutate_json_index(path: Path, mutator: Callable[[object], object]) -> object:
    """Apply one read-modify-write transaction while holding the index lock."""
    path.parent.mkdir(parents=True, exist_ok=True)
    with locked_index(path):
        current = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
        updated = mutator(current)
        _write_json_unlocked(path, updated)
        return updated


@contextmanager
def locked_index(path: Path, *, timeout_seconds: float = 10.0, poll_seconds: float = 0.05) -> Iterator[None]:
    lock_path = path.with_suffix(path.suffix + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    fd: int | None = None
    while fd is None:
        try:
            fd = os.open(str(lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()}\n".encode("ascii"))
        except (FileExistsError, PermissionError):
            try:
                lock_age = time.time() - lock_path.stat().st_mtime
                if lock_age > max(30.0, timeout_seconds * 3):
                    lock_path.unlink()
                    continue
            except FileNotFoundError:
                continue
            if time.monotonic() - started > timeout_seconds:
                raise TimeoutError(f"timed out waiting for translation index lock: {lock_path}")
            time.sleep(poll_seconds)
    try:
        yield
    finally:
        if fd is not None:
            os.close(fd)
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass


def _write_json_unlocked(path: Path, payload: object) -> None:
    temp_path = path.with_suffix(path.suffix + f".{os.getpid()}.{time.time_ns()}.tmp")
    temp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(path)
