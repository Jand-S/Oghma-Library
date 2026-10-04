"""Regras do perfil: apelido e avatar. A lista de avatares e cores é a mesma do app
(`apps/desktop/src/core/avatars.ts`); um teste do app confere as duas."""
from __future__ import annotations

import re
import unicodedata

AVATAR_IDS: tuple[str, ...] = (
    "cultivador",
    "mestra-seita",
    "mago-reencarnado",
    "vila-otome",
    "regressor",
    "cacadora",
    "detetive",
    "alquimista",
    "princesa-guerreira",
    "necromante",
    "estudante-academia",
    "espadachim",
    "rainha-demonio",
    "ferreiro-anao",
    "elfa-arqueira",
    "hacker-vrmmo",
    "sacerdotisa",
    "cavaleiro-negro",
    "bruxa",
    "samurai",
    "kunoichi",
    "monge",
    "vampira",
    "piloto-estelar",
)

AVATAR_COLORS: tuple[str, ...] = (
    "coral",
    "tangerina",
    "ambar",
    "lima",
    "menta",
    "turquesa",
    "celeste",
    "anil",
    "lavanda",
    "orquidea",
    "rosa",
    "grafite",
)

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
