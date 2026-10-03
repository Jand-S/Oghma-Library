"""Gera o catalog.sqlite (por site) a partir dos NovelRecord."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from .records import NovelRecord, SourceRecord
from ..taxonomy import TAXONOMY_VERSION, build_tag_items, canonical_tag_keys

_SCHEMA = """
CREATE TABLE source (
  id TEXT PRIMARY KEY, name TEXT, base_url TEXT, novel_count INTEGER, last_sync TEXT
);
CREATE TABLE novel (
  id TEXT PRIMARY KEY, source_id TEXT, slug TEXT, title TEXT, author TEXT, description TEXT,
  cover_url TEXT, language TEXT, status TEXT, tags TEXT, tag_keys TEXT, chapter_count INTEGER, updated_at TEXT,
  extra TEXT, bundle_key TEXT, bundle_version INTEGER, bundle_sha256 TEXT, bundle_bytes INTEGER
);
CREATE INDEX ix_novel_status ON novel(status);
CREATE INDEX ix_novel_count ON novel(chapter_count);
CREATE TABLE chapter (
  id TEXT PRIMARY KEY, novel_id TEXT, number REAL, title TEXT, published_at TEXT, word_count INTEGER
);
CREATE INDEX ix_chapter_novel ON chapter(novel_id, number);
"""


def cover_ext(cover_path: str | None) -> str:
    if not cover_path:
        return "jpg"
    suf = Path(cover_path).suffix.lstrip(".").lower()
    return suf or "jpg"


def cover_key(novel: NovelRecord) -> str | None:
    if not novel.cover_path:
        return None
    return f"covers/{novel.source_id}/{novel.slug}.{cover_ext(novel.cover_path)}"


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
                # Total anunciado pelo site; maior que chapterCount = coleta ainda incompleta.
                "sourceChapterCount": (n.extra or {}).get("source_chapter_count"),
                "updatedAt": n.updated_at,
                "extra": n.extra or {},
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


def build_catalog(out_path: str, source: SourceRecord, novels: list[NovelRecord], bundle_info: dict) -> None:
    """bundle_info: {novel_id: {"key","version","sha256","bytes"}} (versoes vindas do state)."""
    out = Path(out_path)
    if out.exists():
        out.unlink()
    out.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(out))
    try:
        conn.executescript(_SCHEMA)
        fts_ok = True
        try:
            conn.execute("CREATE VIRTUAL TABLE novel_fts USING fts5(novel_id UNINDEXED, title, author)")
        except sqlite3.OperationalError:
            fts_ok = False  # sqlite sem FTS5: degrada (busca por LIKE no cliente)

        conn.execute(
            "INSERT INTO source(id,name,base_url,novel_count,last_sync) VALUES (?,?,?,?,?)",
            (source.id, source.name, source.base_url, len(novels), source.last_sync),
        )
        for n in novels:
            bi = bundle_info.get(n.id, {})
            conn.execute(
                """INSERT INTO novel(id,source_id,slug,title,author,description,cover_url,language,
                       status,tags,tag_keys,chapter_count,updated_at,extra,bundle_key,bundle_version,bundle_sha256,bundle_bytes)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    n.id, n.source_id, n.slug, n.title, n.author, n.description, cover_key(n),
                    n.language, n.status, json.dumps(n.tags or [], ensure_ascii=False),
                    json.dumps(n.tag_keys or canonical_tag_keys(n.tags or []), ensure_ascii=False),
                    len(n.chapters), n.updated_at, json.dumps(n.extra or {}, ensure_ascii=False),
                    bi.get("key"), bi.get("version"), bi.get("sha256"), bi.get("bytes"),
                ),
            )
            conn.executemany(
                "INSERT INTO chapter(id,novel_id,number,title,published_at,word_count) VALUES (?,?,?,?,?,?)",
                [(c.id, n.id, float(c.number), c.title, c.published_at, c.word_count) for c in n.chapters],
            )
            if fts_ok:
                conn.execute(
                    "INSERT INTO novel_fts(novel_id,title,author) VALUES (?,?,?)",
                    (n.id, n.title or "", n.author or ""),
                )
        conn.commit()
    finally:
        conn.close()
