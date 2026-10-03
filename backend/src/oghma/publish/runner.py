"""Orquestra o publish: read -> bundles (mudados) -> catalog -> covers -> upload (ordem atomica)."""
from __future__ import annotations

import asyncio
import gzip
import json
import os
import time
from pathlib import Path
from typing import Callable

from .bundles import build_bundle, bundle_key
from .catalog import build_catalog, build_catalog_json
from .covers import plan_covers
from .hashing import content_hash, file_sha256
from .reader import read_source
from .state import load_state, publish_lock, save_state
from .uploader import DryRunUploader, make_uploader


def _ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())


def _index_from_state(state: dict) -> dict:
    return {
        "schema": 1,
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sites": list(state.get("sites", {}).values()),
    }


def _gzip_file(source: Path, destination: Path) -> None:
    with open(source, "rb") as fi, gzip.open(destination, "wb") as fo:
        fo.writelines(fi)


def _write_gzip_bytes(destination: Path, data: bytes) -> None:
    destination.write_bytes(gzip.compress(data))


async def _upload_files(up, files: list[tuple[str, str, str]], concurrency: int = 4) -> None:
    semaphore = asyncio.Semaphore(concurrency)

    async def upload(local: str, key: str, content_type: str) -> None:
        async with semaphore:
            await asyncio.to_thread(up.put_file, local, key, content_type)

    await asyncio.gather(*(upload(*item) for item in files))


def _keep_local() -> bool:
    """OGHMA_PUBLISH_KEEP_LOCAL=0: a VPS nao guarda bundles depois de subir (o B2 e a copia)."""
    return os.environ.get("OGHMA_PUBLISH_KEEP_LOCAL", "1").strip() not in ("0", "false", "no")


async def _ensure_hot(session, novel_id: str) -> bool:
    """Traz de volta do B2 os capitulos de uma novel fria antes de remontar o bundle."""
    try:
        from .. import coldstore
    except ImportError:  # armazenamento frio ainda nao instalado: tudo e local
        return True
    return await coldstore.ensure_hot(session, novel_id)


async def run(source_id: str, *, out_dir: str | None = None, no_upload: bool = False,
              dry_run: bool = False, full: bool = False,
              progress: Callable[[dict], None] | None = None,
              lock_timeout: float | None = None, ensure_hot=None) -> dict:
    """Publica uma fonte sob a trava unica de publicacao (API, script diario e rodizio)."""
    from ..config import get_settings

    settings = get_settings()
    timeout = lock_timeout if lock_timeout is not None else float(os.environ.get("OGHMA_PUBLISH_LOCK_TIMEOUT", "3600"))
    lock = publish_lock(str(Path(settings.storage_root) / "publish.lock"), timeout=timeout)
    await asyncio.to_thread(lock.__enter__)
    try:
        return await _run_locked(source_id, out_dir=out_dir, no_upload=no_upload, dry_run=dry_run,
                                 full=full, progress=progress, ensure_hot=ensure_hot or _ensure_hot)
    finally:
        lock.__exit__(None, None, None)


async def _run_locked(source_id: str, *, out_dir, no_upload, dry_run, full, progress, ensure_hot) -> dict:
    from ..config import get_settings
    from ..db import SessionLocal

    settings = get_settings()
    work = Path(out_dir or (Path(settings.storage_root) / "publish"))
    work.mkdir(parents=True, exist_ok=True)
    state_path = str(Path(settings.storage_root) / "publish_state.json")
    state = load_state(state_path)

    async with SessionLocal() as session:
        source, novels = await read_source(session, source_id)

    missing_covers = 0
    for novel in novels:
        if novel.cover_path and not Path(novel.cover_path).is_file():
            novel.cover_path = None
            missing_covers += 1

    if progress:
        progress({"phase": "building", "novels": len(novels), "missingCovers": missing_covers})

    bundle_info: dict = {}
    changed: list = []
    async with SessionLocal() as hot_session:
        for n in novels:
            h = content_hash(n.chapters)
            prev = state["novels"].get(n.id, {})
            if full or prev.get("content_hash") != h:
                # Novel fria (capitulos so no B2): traz de volta antes de remontar o bundle.
                if not await ensure_hot(hot_session, n.id):
                    raise RuntimeError(f"nao foi possivel reidratar {n.id} do B2; publicacao abortada")
                version = int(prev.get("version", 0)) + 1
                key = bundle_key(n, version)
                local = work / key
                asset_dir = Path(settings.storage_root) / "assets" / n.source_id / n.slug
                sha, size = await asyncio.to_thread(
                    build_bundle, str(local), n, version, asset_dir=str(asset_dir)
                )
                state["novels"][n.id] = {"content_hash": h, "version": version, "key": key,
                                         "sha256": sha, "bytes": size}
                changed.append((n, local))
            info = state["novels"][n.id]
            bundle_info[n.id] = {"key": info["key"], "version": info["version"],
                                 "sha256": info["sha256"], "bytes": info["bytes"]}

    ts = _ts()
    catalog_key = f"catalog/{source_id}-{ts}.sqlite.gz"
    catalog_sqlite = work / f"catalog/{source_id}-{ts}.sqlite"
    await asyncio.to_thread(build_catalog, str(catalog_sqlite), source, novels, bundle_info)
    catalog_gz = work / catalog_key
    await asyncio.to_thread(_gzip_file, catalog_sqlite, catalog_gz)
    catalog_sha, _ = await asyncio.to_thread(file_sha256, catalog_gz)

    # Catalogo JSON leve (consumido pelo desktop sem SQLite).
    catalog_json_key = f"catalog/{source_id}-{ts}.json.gz"
    catalog_json_gz = work / catalog_json_key
    catalog_json = await asyncio.to_thread(build_catalog_json, source, novels, bundle_info)
    await asyncio.to_thread(_write_gzip_bytes, catalog_json_gz, catalog_json)
    catalog_json_sha, _ = await asyncio.to_thread(file_sha256, catalog_json_gz)

    prev_site = state["sites"].get(source_id, {})
    state["sites"][source_id] = {
        "id": source_id, "name": source.name, "catalogKey": catalog_key,
        "catalogSha256": catalog_sha,
        "catalogJsonKey": catalog_json_key, "catalogJsonSha256": catalog_json_sha,
        "catalogVersion": int(prev_site.get("catalogVersion", 0)) + 1,
        "novelCount": len(novels), "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    index = _index_from_state(state)
    index_bytes = json.dumps(index, ensure_ascii=False, indent=2).encode("utf-8")
    (work / "index.json").write_bytes(index_bytes)

    cover_plan = [c for c in plan_covers([n for n, _ in changed])]
    summary = {"novels": len(novels), "bundles_changed": len(changed), "covers": len(cover_plan),
               "missing_covers": missing_covers, "catalog_key": catalog_key,
               "catalog_json_key": catalog_json_key, "uploaded": False}

    if not no_upload:
        up = make_uploader(dry_run)
        # ORDEM ATOMICA: bundles -> covers -> catalog -> catalog.json -> index.json (por ultimo)
        files = [
            (str(local), state["novels"][n.id]["key"], "application/gzip")
            for n, local in changed
        ]
        files.extend((c["local"], c["key"], c["content_type"]) for c in cover_plan)
        if progress:
            progress({"phase": "uploading", "uploadItems": len(files) + 3})
        concurrency = max(1, min(settings.publish_upload_concurrency, 16))
        await _upload_files(up, files, concurrency=concurrency)
        await asyncio.to_thread(up.put_file, str(catalog_gz), catalog_key, "application/gzip")
        await asyncio.to_thread(up.put_file, str(catalog_json_gz), catalog_json_key, "application/gzip")
        await asyncio.to_thread(up.put_bytes, index_bytes, "index.json", "application/json")
        summary["uploaded"] = not dry_run
        if isinstance(up, DryRunUploader):
            summary["dry_run_ops"] = up.ops
        elif not _keep_local():
            # O B2 e a copia dos bundles; a VPS so guarda o estado e os catalogos atuais.
            freed = 0
            for _, local in changed:
                try:
                    freed += local.stat().st_size
                    local.unlink()
                except FileNotFoundError:
                    pass
            summary["local_bundles_removed_bytes"] = freed

    # so persiste o state se subiu de verdade
    if not no_upload and not dry_run:
        save_state(state_path, state)

    return summary
