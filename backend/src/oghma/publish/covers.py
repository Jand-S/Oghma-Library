"""Plano de upload das capas (arquivos soltos, sem recompressao)."""
from __future__ import annotations

from pathlib import Path

from .catalog import cover_key
from .records import NovelRecord

_CT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif"}


def plan_covers(novels: list[NovelRecord]) -> list[dict]:
    """Retorna [{local, key, content_type}] para novels com capa baixada."""
    out = []
    for n in novels:
        if not n.cover_path:
            continue
        key = cover_key(n)
        ext = Path(n.cover_path).suffix.lstrip(".").lower()
        out.append({"local": n.cover_path, "key": key, "content_type": _CT.get(ext, "application/octet-stream")})
    return out
