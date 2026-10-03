"""URL de uma novel -> NovelRef do conector, para coletar ou testar uma novel especifica."""
from __future__ import annotations

from urllib.parse import urlsplit

from .base import NovelRef

# Trechos de caminho que sao prefixo de rota, nao o slug da novel.
_ROUTE_WORDS = {"novel", "novels", "series", "serie", "book", "books", "manga", "obra", "obras",
                "read", "ler", "titles", "title", "category", "categoria", "projects", "project", "index.php"}


def domain_of(url: str) -> str:
    host = urlsplit(url if "://" in url else f"https://{url}").hostname or ""
    return host.lower().removeprefix("www.")


def slug_guess(url: str) -> str | None:
    """Ultimo trecho do caminho que nao e rota nem capitulo (`/series/foo/` -> `foo`)."""
    parts = [p for p in urlsplit(url).path.split("/") if p]
    for part in reversed(parts):
        low = part.lower()
        if low in _ROUTE_WORDS or low.startswith(("cap", "chapter", "ch-", "episode")):
            continue
        return part
    return None


def novel_ref_from_url(connector, url: str) -> NovelRef:
    """Usa `ref_from_url` do conector; senao `slug_from_url`; senao o palpite pelo caminho."""
    custom = getattr(connector, "ref_from_url", None)
    if callable(custom):
        ref = custom(url)
        if ref is not None:
            return ref
    slugger = getattr(connector, "slug_from_url", None)
    slug = slugger(url) if callable(slugger) else None
    slug = slug or slug_guess(url)
    if not slug:
        raise ValueError(f"nao foi possivel achar a novel na URL: {url}")
    return NovelRef(connector.id, slug, url)
