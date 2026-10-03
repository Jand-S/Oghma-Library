"""`oghma discovery-build`: calcula os parecidos de todo o catalogo e publica no B2.

O modelo roda fora da trava de publicacao (minutos na primeira vez, segundos depois, com o
cache de vetores); a trava so segura o upload do arquivo e a regravacao do index.json, que
passa a apontar para ele (`discovery.similarKey`).
"""
from __future__ import annotations

import asyncio
import gzip
import json
import time
from pathlib import Path

from .similar import (MODEL, DiscoveryNovel, EmbeddingCache, build_discovery, embed, load_fichas, novel_text,
                      synopsis_text)


async def read_novels(source_ids: list[str]) -> list[DiscoveryNovel]:
    from sqlalchemy import select

    from ..db import SessionLocal
    from ..models import Novel
    from ..taxonomy import canonical_tag_keys

    async with SessionLocal() as session:
        rows = (await session.execute(
            select(Novel.id, Novel.source_id, Novel.title, Novel.language, Novel.description, Novel.tags, Novel.tag_keys)
            .where(Novel.source_id.in_(source_ids)).order_by(Novel.id)
        )).all()
    return [DiscoveryNovel(id=r.id, source_id=r.source_id, title=r.title, language=r.language or "",
                           description=r.description, tags=list(r.tags or []),
                           tag_keys=list(r.tag_keys or []) or canonical_tag_keys(r.tags or []))
            for r in rows]


def _ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())


async def run(*, dry_run: bool = False, no_upload: bool = False) -> dict:
    from ..config import get_settings
    from ..publish.runner import _index_from_state
    from ..publish.state import load_state, publish_lock, save_state
    from ..publish.uploader import make_uploader

    settings = get_settings()
    root = Path(settings.storage_root)
    work = root / "discovery"
    work.mkdir(parents=True, exist_ok=True)
    state_path = str(root / "publish_state.json")
    sources = list(load_state(state_path).get("sites", {}).keys())
    novels = await read_novels(sources)
    fichas = load_fichas(work / "fichas.json")

    started = time.time()
    cache = EmbeddingCache(work)
    cache.load()
    story_vecs, story_keys = await asyncio.to_thread(
        embed, [novel_text(n, fichas.get(n.id)) for n in novels], MODEL, cache)
    synopsis_vecs, synopsis_keys = await asyncio.to_thread(embed, [synopsis_text(n) for n in novels], MODEL, cache)
    data = await asyncio.to_thread(build_discovery, novels, story_vecs, synopsis_vecs)
    cache.save(story_keys | synopsis_keys)

    payload = {"schema": 1, "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "model": MODEL,
               "novels": len(novels), "withFicha": sum(1 for n in novels if n.id in fichas), **data}
    raw = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"), mtime=0)
    import hashlib

    sha = hashlib.sha256(raw).hexdigest()
    key = f"discovery/similar-{_ts()}.json.gz"
    local = work / Path(key).name
    local.write_bytes(raw)
    summary = {"novels": len(novels), "withFicha": payload["withFicha"], "editions": len(data["editions"]),
               "seconds": round(time.time() - started, 1), "key": key, "bytes": len(raw), "uploaded": False}
    if no_upload:
        return summary

    lock = publish_lock(str(root / "publish.lock"))
    await asyncio.to_thread(lock.__enter__)
    try:
        state = load_state(state_path)
        up = make_uploader(dry_run)
        await asyncio.to_thread(up.put_file, str(local), key, "application/gzip")
        state["discovery"] = {"similarKey": key, "similarSha256": sha, "builtAt": payload["builtAt"],
                              "model": MODEL, "novels": len(novels)}
        index = json.dumps(_index_from_state(state), ensure_ascii=False, indent=2).encode("utf-8")
        await asyncio.to_thread(up.put_bytes, index, "index.json", "application/json")
        if not dry_run:
            save_state(state_path, state)
            summary["uploaded"] = True
    finally:
        lock.__exit__(None, None, None)
    return summary
