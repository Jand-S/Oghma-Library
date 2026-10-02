"""Monta o bundle de uma novel: tar.gz com meta.json + chapters/<n>.html."""
from __future__ import annotations

import io
import json
import tarfile
import time
from pathlib import Path
import re

from .hashing import file_sha256
from .records import NovelRecord

_ASSET_RE = re.compile(r'src="\.\./assets/([a-zA-Z0-9._-]+)"')


def _default_read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def _add_bytes(tar: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mtime = 0  # deterministico
    tar.addfile(info, io.BytesIO(data))


def build_bundle(
    out_path: str,
    novel: NovelRecord,
    version: int,
    read_content=_default_read,
    asset_dir: str | None = None,
) -> tuple[str, int]:
    """Escreve o .tar.gz e retorna (sha256, bytes). So inclui capitulos com content_path."""
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    chapters_meta = []
    asset_names: set[str] = set()
    with tarfile.open(out, "w:gz") as tar:
        for c in sorted(novel.chapters, key=lambda x: x.number):
            if not c.content_path:
                continue
            try:
                html = read_content(c.content_path)
            except FileNotFoundError:
                continue
            if not html.strip():
                continue  # arquivo vazio nunca vira capitulo em branco no livro
            fname = f"chapters/{c.number:g}.html"
            _add_bytes(tar, fname, html.encode("utf-8"))
            asset_names.update(_ASSET_RE.findall(html))
            chapters_meta.append(
                {"number": c.number, "title": c.title, "file": fname, "words": c.word_count}
            )
        for asset_name in sorted(asset_names):
            asset_path = Path(asset_dir) / asset_name if asset_dir else None
            if asset_path is not None and asset_path.is_file():
                _add_bytes(tar, f"assets/{asset_name}", asset_path.read_bytes())
        meta = {
            "id": novel.id,
            "source_id": novel.source_id,
            "slug": novel.slug,
            "title": novel.title,
            "bundle_version": version,
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "chapters": chapters_meta,
            "missingChapters": novel.missing,
            "assets": sorted(asset_names),
        }
        _add_bytes(tar, "meta.json", json.dumps(meta, ensure_ascii=False, indent=2).encode("utf-8"))
    sha, size = file_sha256(out)
    return sha, size


def bundle_key(novel: NovelRecord, version: int) -> str:
    return f"content/{novel.source_id}/{novel.slug}/{novel.slug}.v{version}.tar.gz"
