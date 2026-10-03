"""Limpeza de versoes antigas de bundles e catalogos (B2 e disco local).

Mantem por novel as ultimas `keep` versoes de bundle e por fonte os ultimos `keep`
catalogos (sqlite.gz e json.gz). Nunca apaga o que o publish_state (e portanto o
index.json) referencia como atual.
"""
from __future__ import annotations

import re
from pathlib import Path

_BUNDLE_RE = re.compile(r"^content/(?P<src>[^/]+)/(?P<slug>[^/]+)/(?P=slug)\.v(?P<ver>\d+)\.tar\.gz$")
_CATALOG_RE = re.compile(r"^catalog/(?P<src>.+)-(?P<ts>\d{8}-\d{6})\.(?P<kind>sqlite\.gz|json\.gz|sqlite)$")


def referenced_keys(state: dict) -> set[str]:
    keys = {n.get("key") for n in state.get("novels", {}).values()}
    for site in state.get("sites", {}).values():
        keys.update({site.get("catalogKey"), site.get("catalogJsonKey")})
        if site.get("catalogKey", "").endswith(".gz"):
            keys.add(site["catalogKey"][:-3])  # sqlite local sem gzip
    keys.add("index.json")
    return {k for k in keys if k}


def plan_prune(keys: list[str], state: dict, *, keep: int = 2, source: str | None = None) -> list[str]:
    """Chaves a apagar dentre `keys` (relativas: content/..., catalog/...)."""
    keep = max(1, keep)
    protected = referenced_keys(state)
    bundles: dict[tuple[str, str], list[tuple[int, str]]] = {}
    catalogs: dict[tuple[str, str], list[tuple[str, str]]] = {}
    for key in keys:
        m = _BUNDLE_RE.match(key)
        if m:
            if source and m["src"] != source:
                continue
            bundles.setdefault((m["src"], m["slug"]), []).append((int(m["ver"]), key))
            continue
        m = _CATALOG_RE.match(key)
        if m:
            if source and m["src"] != source:
                continue
            kind = "json" if m["kind"] == "json.gz" else "sqlite"
            catalogs.setdefault((m["src"], kind), []).append((m["ts"], key))
    out: list[str] = []
    for items in bundles.values():
        items.sort(reverse=True)
        out.extend(k for _, k in items[keep:] if k not in protected)
    for items in catalogs.values():
        items.sort(reverse=True)
        out.extend(k for _, k in items[keep:] if k not in protected)
    return sorted(out)


def local_keys(root: Path) -> dict[str, int]:
    out: dict[str, int] = {}
    for sub in ("content", "catalog"):
        base = root / sub
        if not base.exists():
            continue
        for p in base.rglob("*"):
            if p.is_file():
                out[p.relative_to(root).as_posix()] = p.stat().st_size
    return out


def prune(state: dict, *, work_dir: Path, remote: dict[str, int] | None, uploader=None,
          keep: int = 2, source: str | None = None, dry_run: bool = False) -> dict:
    """remote: {chave: bytes} listado do B2 (None = nao mexe no B2)."""
    local = local_keys(work_dir)
    report = {"keep": keep, "source": source, "dry_run": dry_run,
              "local": {"files": 0, "bytes": 0}, "remote": {"files": 0, "bytes": 0}}
    for key in plan_prune(list(local), state, keep=keep, source=source):
        report["local"]["files"] += 1
        report["local"]["bytes"] += local[key]
        if not dry_run:
            (work_dir / key).unlink(missing_ok=True)
    if remote is not None:
        doomed = plan_prune(list(remote), state, keep=keep, source=source)
        report["remote"]["files"] = len(doomed)
        report["remote"]["bytes"] = sum(remote[k] for k in doomed)
        if doomed and not dry_run and uploader is not None:
            uploader.delete_keys(doomed)
    return report
