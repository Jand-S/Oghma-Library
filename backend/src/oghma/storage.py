"""Storage em filesystem para html bruto, conteudo limpo, capas e exports."""
from __future__ import annotations

import gzip
import hashlib
import re
from pathlib import Path

from .config import get_settings


def _root() -> Path:
    return Path(get_settings().storage_root)


def _safe(part: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", part).strip("-") or "x"


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _ensure(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def save_raw(source: str, slug: str, number: float, html: bytes) -> str:
    path = _ensure(_root() / "raw" / _safe(source) / _safe(slug) / f"{number}.html.gz")
    with gzip.open(path, "wb") as fh:
        fh.write(html)
    return str(path)


def save_content(source: str, slug: str, number: float, html: str) -> str:
    path = _ensure(_root() / "content" / _safe(source) / _safe(slug) / f"{number}.html")
    path.write_text(html, encoding="utf-8")
    return str(path)


def read_content(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def save_cover(source: str, slug: str, data: bytes, ext: str = "jpg") -> str:
    path = _ensure(_root() / "covers" / _safe(source) / f"{_safe(slug)}.{_safe(ext)}")
    path.write_bytes(data)
    return str(path)


def asset_dir(source: str, slug: str) -> Path:
    path = _root() / "assets" / _safe(source) / _safe(slug)
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_asset(source: str, slug: str, filename: str, data: bytes) -> str:
    path = _ensure(asset_dir(source, slug) / _safe(filename))
    path.write_bytes(data)
    return str(path)


def export_path(novel_id: str, label: str, ext: str) -> Path:
    return _ensure(_root() / "exports" / f"{_safe(novel_id)}-{_safe(label)}.{_safe(ext)}")
