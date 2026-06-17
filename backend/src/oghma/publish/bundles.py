"""Monta o bundle de uma novel: tar.gz com meta.json + chapters/<n>.html."""
from __future__ import annotations

import io
import json
import tarfile
import time
from pathlib import Path

from .hashing import file_sha256
from .records import NovelRecord


def _default_read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = 0  # deterministico
    tar.addfile(info, io.BytesIO(data))


def build_bundle(out_path: str, novel: NovelRecord, version: int, read_content=_default_read) -> tuple[str, int]:
    """Escreve o .tar.gz e retorna (sha256, bytes). So inclui capitulos com content_path."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    chapters_meta = []
    with tarfile.open(out, "w:gz") as tar:
        for c in sorted(novel.chapters, key=lambda x: x.number):
            if not c.content_path:
                continue
            try:
                html = read_content(c.content_path)
            except FileNotFoundError:
                continue
            fname = f"chapters/{c.number:g}.html"
            _add_bytes(tar, fname, html.encode("utf-8"))
            chapters_meta.append(
                {"number": c.number, "title": c.title, "file": fname, "words": c.word_count}
            )
        meta = {
            "id": novel.id,
            "source_id": novel.source_id,
            "slug": novel.slug,
            "title": novel.title,
            "bundle_version": version,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "chapters": chapters_meta,
        }
        _add_bytes(tar, "meta.json", json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8"))
    sha, size = file_sha256(out)
    return sha, size


def bundle_key(novel: NovelRecord, version: int) -> str:
    return f"content/{novel.source_id}/{novel.slug}/{novel.slug}.v{version}.tar.gz"
