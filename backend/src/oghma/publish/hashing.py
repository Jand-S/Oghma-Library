from __future__ import annotations

import hashlib


def content_hash(chapters) -> str:
    """Hash estavel do conteudo de uma novel (muda quando algum capitulo muda)."""
    parts = sorted(f"{c.number:g}:{c.content_hash or ''}" for c in chapters)
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def file_sha256(path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 256), b""):
            h.update(chunk)
            size += len(chunk)
    return h.hexdigest(), size
