"""Orquestra o publish: read -> bundles (mudados) -> catalog -> covers -> upload (ordem atomica)."""
from __future__ import annotations

import gzip
import json
import time
from pathlib import Path

from .bundles import build_bundle, bundle_key
from .catalog import build_catalog, build_catalog_json
from .covers import plan_covers
from .hashing import content_hash, file_sha256
from .reader import read_source
from .state import load_state, save_state
from .uploader import DryRunUploader, make_uploader


def _ts() -> str:
    return time.strftime("%Y%m%d-%H%M%S", time.gmtime())


def _index_from_state(state: dict) -> dict:
    return {
        "schema": 1,
        "builtAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "sites": list(state.get("sites", {}).values()),
    }


async def run(source_id: str, *, out_dir: str | None = None, no_upload: bool = False,
              dry_run: bool = False, full: bool = False) -> dict:
    from ..config import get_settings
    from ..db import SessionLocal

    settings = get_settings()
    work = Path(out_dir or (Path(settings.storage_root) / "publish"))
    work.mkdir(parents=True, exist_ok=True)
    state_path = str(Path(settings.storage_root) / "publish_state.json")
    state = load_state(state_path)

    async with SessionLocal() as session:
        source, novels = await read_source(session, source_id)

    bundle_info: dict = {}
    changed: list = []
    for n in novels:
        h = content_hash(n.chapters)
        prev = state["novels"].get(n.id, {})
        if full or prev.get("content_hash") != h:
            version = int(prev.get("version", 0)) + 1
            key = bundle_key(n, version)
            local = work / key
            sha, size = build_bundle(str(local), n, version)
            state["novels"][n.id] = {"content_hash": h, "version": version, "key": key,
                                     "sha256": sha, "bytes": size}
            changed.append((n, local))
        info = state["novels"][n.id]
        bundle_info[n.id] = {"key": info["key"], "version": info["version"],
                             "sha256": info["sha256"], "bytes": info["bytes"]}

    ts = _ts()
    catalog_key = f"catalog/{source_id}-{ts}.sqlite.gz"
    catalog_sqlite = work / f"catalog/{source_id}-{ts}.sqlite"
    build_catalog(str(catalog_sqlite), source, novels, bundle_info)
    catalog_gz = work / catalog_key
    with open(catalog_sqlite, "rb") as fi, gzip.open(catalog_gz, "wb") as fo:
        fo.writelines(fi)
    catalog_sha, _ = file_sha256(catalog_gz)

    # Catalogo JSON leve (consumido pelo desktop sem SQLite).
    catalog_json_key = f"catalog/{source_id}-{ts}.json.gz"
    catalog_json_gz = work / catalog_json_key
    with gzip.open(catalog_json_gz, "wb") as fo:
        fo.write(build_catalog_json(source, novels, bundle_info))
    catalog_json_sha, _ = file_sha256(catalog_json_gz)

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
               "catalog_key": catalog_key, "catalog_json_key": catalog_json_key, "uploaded": False}

    if not no_upload:
        up = make_uploader(dry_run)
        # ORDEM ATOMICA: bundles -> covers -> catalog -> catalog.json -> index.json (por ultimo)
        for n, local in changed:
            up.put_file(str(local), state["novels"][n.id]["key"], "application/gzip")
        for c in cover_plan:
            up.put_file(c["local"], c["key"], c["content_type"])
        up.put_file(str(catalog_gz), catalog_key, "application/gzip")
        up.put_file(str(catalog_json_gz), catalog_json_key, "application/gzip")
        up.put_bytes(index_bytes, "index.json", "application/json")
        summary["uploaded"] = not dry_run
        if isinstance(up, DryRunUploader):
            summary["dry_run_ops"] = up.ops

    # so persiste o state se subiu de verdade
    if not no_upload and not dry_run:
        save_state(state_path, state)

    return summary
