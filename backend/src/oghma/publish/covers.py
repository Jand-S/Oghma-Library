"""Plano de upload das capas (arquivos soltos, sem recompressao)."""
from __future__ import annotations

from pathlib import Path

from .catalog import cover_key
from .hashing import file_sha256
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


def plan_changed_covers(novels: list[NovelRecord], state_novels: dict) -> list[dict]:
    """Capas cujo arquivo mudou desde a ultima publicacao (sha256 em state["novels"][id]).

    Antes so subiam as capas das novels com capitulo novo: uma capa trocada pelo crawler,
    ou baixada depois da primeira publicacao, nunca chegava ao B2 (o catalogo apontava para
    ela e o app levava 404). Devolve [{local, key, content_type, novel_id, sha256}].
    """
    out = []
    for n in novels:
        if not n.cover_path or not Path(n.cover_path).is_file():
            continue
        sha, _ = file_sha256(n.cover_path)
        if (state_novels.get(n.id) or {}).get("cover_sha256") == sha:
            continue
        item = plan_covers([n])[0]
        item.update({"novel_id": n.id, "sha256": sha})
        out.append(item)
    return out
