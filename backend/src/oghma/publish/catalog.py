"""Gera o catalogo JSON de cada fonte (catalog/<fonte>-<ts>.json.gz) a partir dos NovelRecord."""
from __future__ import annotations

import json
from pathlib import Path

from .records import NovelRecord, SourceRecord
from ..taxonomy import TAXONOMY_VERSION, build_tag_items, canonical_tag_keys



def cover_ext(cover_path: str | None) -> str:
    if not cover_path:
        return "jpg"
    suf = Path(cover_path).suffix.lstrip(".").lower()
    return suf or "jpg"


def cover_key(novel: NovelRecord) -> str | None:
    if not novel.cover_path:
        return None
    return f"covers/{novel.source_id}/{novel.slug}.{cover_ext(novel.cover_path)}"


def _number(value) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None  # 0 nas fontes quase sempre quer dizer "sem dado"


def public_fields(n: NovelRecord) -> dict:
    """Campos normalizados para o app, no lugar do `extra` cru de cada conector.

    - rating: 0 a 5 (notas de 0-10 e 0-100 sao convertidas); None sem dado.
    - ratingVotes / views: inteiros; as fontes usam nomes diferentes (rating_votes, ratings_count).
    - firstSeenAt / lastChapterAt: datas reais (o updatedAt publicado muda a cada crawl).
    - sourceChapterCount: total que o site anuncia (maior que chapterCount = coleta incompleta).
    """
    extra = n.extra or {}
    rating = _number(extra.get("rating"))
    if rating is not None:
        rating = rating / 2 if rating <= 10 and rating > 5 else rating / 20 if rating > 10 else rating
        rating = round(min(rating, 5.0), 2)
    votes = _number(extra.get("rating_votes") or extra.get("ratings_count"))
    views = _number(extra.get("views"))
    return {
        "rating": rating,
        "ratingVotes": int(votes) if votes else None,
        "views": int(views) if views else None,
        "firstSeenAt": n.first_seen_at,
        "lastChapterAt": n.last_new_chapter_at,
        "sourceChapterCount": extra.get("source_chapter_count"),
        **({"aliases": n.aliases} if n.aliases else {}),
    }


def build_catalog_json(source: SourceRecord, novels: list[NovelRecord], bundle_info: dict) -> bytes:
    """Catalogo leve em JSON (consumido pelo desktop sem SQLite).

    bundle_info: {novel_id: {"key","version","sha256","bytes"}}.
    Inclui metadados das novels + lista de capitulos (numero/titulo, sem conteudo).
    """
    counts: dict[str, int] = {}
    raw_labels: dict[str, set[str]] = {}
    for novel in novels:
        keys = novel.tag_keys or canonical_tag_keys(novel.tags or [])
        for key in set(keys):
            counts[key] = counts.get(key, 0) + 1
        for raw in novel.tags or []:
            key = canonical_tag_keys([raw])
            if key:
                raw_labels.setdefault(key[0], set()).add(raw)
    payload = {
        "schema": 1,
        "taxonomyVersion": TAXONOMY_VERSION,
        "source": {"id": source.id, "name": source.name, "baseUrl": source.base_url},
        "taxonomy": build_tag_items(counts, raw_labels),
        "novels": [
            {
                "id": n.id,
                "slug": n.slug,
                "title": n.title,
                "author": n.author,
                "description": n.description,
                "coverUrl": cover_key(n),
                "language": n.language,
                "status": n.status,
                "tags": n.tags or [],
                "tagKeys": n.tag_keys or canonical_tag_keys(n.tags or []),
                "chapterCount": len(n.chapters),
                "updatedAt": n.updated_at,
                # Sem o `extra` cru: ele levava campos internos (ids do conector, cover_checked_at).
                **public_fields(n),
                "bundleKey": bundle_info.get(n.id, {}).get("key"),
                "bundleVersion": bundle_info.get(n.id, {}).get("version"),
                "bundleSha256": bundle_info.get(n.id, {}).get("sha256"),
                "bundleBytes": bundle_info.get(n.id, {}).get("bytes"),
                "chapters": [{"number": c.number, "title": c.title} for c in n.chapters],
                "missingChapters": n.missing,
            }
            for n in novels
        ],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


