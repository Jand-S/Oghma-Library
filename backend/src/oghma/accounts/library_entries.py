"""Linhas da biblioteca no fio: validação do que o app manda e o formato que volta.

Duas famílias de chave:
- `novel:<id>`: livro do catálogo. Grava `novel_id = <id>`.
- `import:<sha256>`: EPUB próprio importado. Grava a chave inteira em `novel_id` e é sempre
  `private` (nunca vai para amigos nem para a atividade).
"""
from __future__ import annotations

import re
from typing import Any

from .errors import AccountError
from .models import AccountLibraryEntry

READING_STATUSES = {"unread", "reading", "paused", "completed", "dropped"}
MAX_TAGS = 30
MAX_TAG_LEN = 40
MAX_SNAPSHOT_TEXT = 600
NOVEL_KEY_PREFIX = "novel:"
IMPORT_KEY_PREFIX = "import:"
IMPORT_KEY_RE = re.compile(r"import:[0-9a-f]{64}")
COVER_EXTS = {"jpg", "png", "webp"}
SNAPSHOT_ORIGINS = {"import"}


def is_import(novel_id: str) -> bool:
    return novel_id.startswith(IMPORT_KEY_PREFIX)


def novel_id_for_key(key: str) -> str:
    """Chave do fio -> `novel_id` gravado. Recusa chaves de pasta, vazias ou ambíguas."""
    if is_import(key):
        if not IMPORT_KEY_RE.fullmatch(key):
            raise AccountError("invalid_entry")
        return key
    if not key.startswith(NOVEL_KEY_PREFIX) or len(key) > 330:
        raise AccountError("invalid_entry")
    novel_id = key[len(NOVEL_KEY_PREFIX):]
    # `novel:import:…` voltaria como `import:…` e trocaria de família.
    if not novel_id or is_import(novel_id):
        raise AccountError("invalid_entry")
    return novel_id


def wire_key(novel_id: str) -> str:
    """`novel_id` gravado -> chave do fio (a mesma que o app mandou)."""
    return novel_id if is_import(novel_id) else f"{NOVEL_KEY_PREFIX}{novel_id}"


def _clean_text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    return int(value)


def _clean_series(raw: Any) -> dict[str, Any] | None:
    """Série de um EPUB importado: id e nome obrigatórios, volume opcional (1, 2, 2.5…)."""
    if not isinstance(raw, dict):
        return None
    series_id = _clean_text(raw.get("id"), 200)
    name = _clean_text(raw.get("name"), 200)
    if not series_id or not name:
        return None
    series: dict[str, Any] = {"id": series_id, "name": name}
    volume = raw.get("volume")
    if not isinstance(volume, bool) and isinstance(volume, (int, float)) and 0 <= volume < 100000:
        series["volume"] = int(volume) if float(volume).is_integer() else float(volume)
    return series


def clean_entry(raw: dict[str, Any]) -> tuple[str, dict[str, Any], int, int | None]:
    """Valida uma linha vinda do app. Devolve (novel_id, dados, changed_at, deleted_at)."""
    novel_id = novel_id_for_key(str(raw.get("key") or ""))
    try:
        changed_at = int(raw.get("changedAt") or 0)
    except (TypeError, ValueError):
        raise AccountError("invalid_entry") from None
    if changed_at <= 0:
        raise AccountError("invalid_entry")
    deleted_at = raw.get("deletedAt")
    deleted_at = int(deleted_at) if isinstance(deleted_at, (int, float)) and deleted_at > 0 else None
    status = raw.get("readingStatus") if raw.get("readingStatus") in READING_STATUSES else "unread"
    rating = raw.get("rating")
    rating = int(rating) if isinstance(rating, (int, float)) and 1 <= int(rating) <= 5 else None
    tags = [str(tag).strip()[:MAX_TAG_LEN] for tag in (raw.get("tags") or []) if str(tag).strip()][:MAX_TAGS]
    snapshot = clean_snapshot(novel_id, raw.get("snapshot"))
    added_at = raw.get("addedAt")
    # A removed book keeps what the reader marked: bringing it back restores status, rating and tags.
    data = {
        "favorite": bool(raw.get("favorite")),
        "readingStatus": status,
        "rating": rating,
        "tags": tags,
        "onShelf": bool(raw.get("onShelf")) and deleted_at is None,
        "addedAt": int(added_at) if isinstance(added_at, (int, float)) and added_at > 0 else None,
        "snapshot": snapshot,
        # "Só eu vejo": fora do perfil e da atividade que os amigos veem. EPUB importado é sempre.
        "private": True if is_import(novel_id) else bool(raw.get("private")),
    }
    return novel_id, data, changed_at, deleted_at


def clean_snapshot(novel_id: str, snapshot_raw: Any) -> dict[str, Any] | None:
    """Título, autor, fonte e capa do livro (o que o app mostra sem ter o livro no catálogo)."""
    if not isinstance(snapshot_raw, dict) or not snapshot_raw:
        return None
    snapshot = {
        "novelId": novel_id,
        "title": _clean_text(snapshot_raw.get("title"), 300) or novel_id,
        "author": _clean_text(snapshot_raw.get("author"), 200),
        "sourceId": _clean_text(snapshot_raw.get("sourceId"), 64),
        "sourceName": _clean_text(snapshot_raw.get("sourceName"), 120),
        "coverUrl": _clean_text(snapshot_raw.get("coverUrl"), 700) if str(snapshot_raw.get("coverUrl") or "").startswith("https://") else None,
        "chapters": int(snapshot_raw["chapters"]) if isinstance(snapshot_raw.get("chapters"), (int, float)) else None,
        "description": _clean_text(snapshot_raw.get("description"), MAX_SNAPSHOT_TEXT),
        # EPUB importado: de onde veio, idioma, série, tamanho e a extensão da capa guardada na conta.
        "origin": snapshot_raw.get("origin") if snapshot_raw.get("origin") in SNAPSHOT_ORIGINS else None,
        "language": _clean_text(snapshot_raw.get("language"), 35),
        "series": _clean_series(snapshot_raw.get("series")),
        "fileSize": _positive_int(snapshot_raw.get("fileSize")),
        "coverExt": snapshot_raw.get("coverExt") if snapshot_raw.get("coverExt") in COVER_EXTS else None,
    }
    return {k: v for k, v in snapshot.items() if v is not None}


def entry_out(entry: AccountLibraryEntry) -> dict[str, Any]:
    data = entry.data or {}
    return {
        "key": wire_key(entry.novel_id),
        "favorite": bool(data.get("favorite")),
        "readingStatus": data.get("readingStatus") or "unread",
        "rating": data.get("rating"),
        "tags": data.get("tags") or [],
        # Ocultar é por dispositivo: nunca vem da conta.
        "hidden": False,
        "onShelf": bool(data.get("onShelf")),
        "addedAt": data.get("addedAt"),
        "snapshot": data.get("snapshot"),
        "private": bool(data.get("private")) or is_import(entry.novel_id),
        "changedAt": entry.changed_at,
        "deletedAt": entry.deleted_at,
        "seq": entry.seq,
    }
