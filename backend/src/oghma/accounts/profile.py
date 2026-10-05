"""Regras do perfil: apelido e avatar.

Os avatares válidos (personagens e variantes dos originais) e as cores vêm de `avatars.json`,
gerado junto com o catálogo do app; um teste do app confere os dois."""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

# Gerado por `apps/desktop/scripts/avatars/build.py` (personagens + variantes dos originais e as cores).
_AVATARS = json.loads((Path(__file__).parent / "avatars.json").read_text())
AVATAR_IDS: tuple[str, ...] = tuple(_AVATARS["ids"])
AVATAR_COLORS: tuple[str, ...] = tuple(_AVATARS["colors"])

NICKNAME_MIN = 3
NICKNAME_MAX = 20
# Letras (com acento), números, "_" e "."; começa e termina com letra ou número.
_NICKNAME_RE = re.compile(r"^[^\W_](?:[\w.]*[^\W_])?$", re.UNICODE)

RESERVED = {
    "admin", "administrador", "oghma", "oghmalibrary", "suporte", "support", "root", "system",
    "sistema", "moderador", "moderator", "staff", "equipe", "oficial", "official", "null", "undefined",
}


def nickname_key(nickname: str) -> str:
    """Forma de comparação: sem acento, minúsculas."""
    decomposed = unicodedata.normalize("NFKD", nickname.strip())
    return "".join(ch for ch in decomposed if not unicodedata.combining(ch)).casefold()


def nickname_problem(nickname: str) -> str | None:
    """Motivo para recusar o apelido, ou None se ele é válido (sem olhar se já existe)."""
    value = nickname.strip()
    if len(value) < NICKNAME_MIN:
        return "too_short"
    if len(value) > NICKNAME_MAX:
        return "too_long"
    if not _NICKNAME_RE.match(value) or ".." in value:
        return "invalid_chars"
    if nickname_key(value).replace(".", "").replace("_", "") in RESERVED:
        return "reserved"
    return None


def nickname_suggestions(nickname: str, taken: set[str], count: int = 3) -> list[str]:
    """Alternativas livres para um apelido ocupado ("jandson" → "jandson.br", "jandson_7"…)."""
    base = re.sub(r"[^\w.]", "", nickname.strip())[: NICKNAME_MAX - 4] or "leitor"
    candidates = [f"{base}.lê", f"{base}_br", f"{base}.livros", *[f"{base}{n}" for n in range(2, 100)]]
    out: list[str] = []
    for candidate in candidates:
        candidate = candidate[:NICKNAME_MAX]
        if nickname_problem(candidate) is None and nickname_key(candidate) not in taken:
            out.append(candidate)
        if len(out) >= count:
            break
    return out
