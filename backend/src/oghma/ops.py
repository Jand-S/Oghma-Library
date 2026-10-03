"""Rotina da VPS: backup do banco no bucket privado e aviso de disco no brain."""
from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from . import coldstore
from .rodizio import brain_notify

BACKUP_PREFIX = "backups/db/"


def _pg_url() -> str:
    """URL do SQLAlchemy (postgresql+asyncpg://) no formato do pg_dump."""
    url = os.environ["OGHMA_DATABASE_URL"]
    return url.replace("postgresql+asyncpg://", "postgresql://", 1).replace("postgresql+psycopg://", "postgresql://", 1)


def backup_db(*, keep: int = 14, store=None, dump=None, now: datetime | None = None) -> dict:
    """pg_dump -Fc -> `backups/db/<data>.dump` no bucket privado; mantem as `keep` mais novas."""
    store = store or coldstore.get_private_store()
    if store is None:
        raise RuntimeError("OGHMA_S3_PRIVATE_BUCKET nao configurado: o backup nunca vai para o bucket publico.")
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H%M")
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "oghma.dump"
        if dump is None:
            subprocess.run(["pg_dump", "-Fc", "--no-owner", "-f", str(out), _pg_url()], check=True, timeout=3600)
        else:
            dump(out)
        data = out.read_bytes()
    key = f"{BACKUP_PREFIX}{stamp}.dump"
    store.put(key, data, "application/octet-stream")
    old = sorted(k for k in store.list(BACKUP_PREFIX) if k.endswith(".dump"))[:-keep] if keep > 0 else []
    if old:
        store.delete(old)
    return {"key": key, "bytes": len(data), "removed": old}


def disk_check(*, disk_limit: float = 0.80, cap_limit: float = 0.90, root: Path | None = None, notify=brain_notify) -> dict:
    """Avisa no brain se o disco passar de 80% ou o acervo quente passar de 90% do teto."""
    root = root or coldstore._storage_root()
    usage = shutil.disk_usage(root)
    hot = coldstore.dir_bytes(root / "content") + coldstore.dir_bytes(root / "assets")
    cap = float(os.environ.get("OGHMA_HOT_CAP_GB", coldstore.DEFAULT_CAP_GB)) * 1024**3
    disk_ratio, hot_ratio = usage.used / usage.total, hot / cap
    report = {"disk_used": round(disk_ratio, 3), "hot_gb": round(hot / 1024**3, 2), "hot_cap_ratio": round(hot_ratio, 3)}
    problems = []
    if disk_ratio >= disk_limit:
        problems.append(f"Disco da VPS em {disk_ratio:.0%} ({usage.free / 1024**3:.1f} GB livres).")
    if hot_ratio >= cap_limit:
        problems.append(f"Acervo quente com {hot / 1024**3:.1f} GB, {hot_ratio:.0%} do teto de {cap / 1024**3:.0f} GB: o evict nao esta dando conta.")
    if problems:
        notify("warn", "Oghma: disco quase cheio", " ".join(problems), thread="oghma-disk")
    report["warned"] = bool(problems)
    return report
