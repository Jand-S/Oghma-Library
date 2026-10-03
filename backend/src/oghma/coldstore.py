"""Armazenamento quente/frio do acervo.

Quente (`novel.storage_state = 'hot'`): `content/` e `assets/` da novel ficam no disco.
Frio (`'cold'`): os arquivos locais foram apagados e a fonte da verdade e o bundle
publicado no B2 (que tem `chapters/<n>.html`, `assets/*` e `meta.json`). Uma novel fria
e reidratada a partir do bundle quando volta a receber capitulo ou precisa ser publicada.

A logica de arquivos e a escolha do que esfriar sao funcoes puras (testaveis sem banco);
`ensure_hot` e `evict` sao a camada fina que fala com o banco.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import tarfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .config import get_settings

DEFAULT_CAP_GB = 20.0
MIN_WINDOW_DAYS = 30


# ------------------------------------------------------------------ B2

class BundleStore:
    """Leitura de bundles no B2 (S3). Injetavel nos testes."""

    def __init__(self, client=None, bucket: str | None = None, private: bool = False):
        self._client, self._bucket, self._private = client, bucket, private

    def _ensure(self):
        if self._client is None:
            import boto3  # import tardio, como no uploader

            env = os.environ
            if self._private:
                # Bucket privado (raw, backups): o bucket publico serve b2.jandson.me para qualquer um.
                # Chaves proprias opcionais, para uma application key restrita a esse bucket.
                self._bucket = env["OGHMA_S3_PRIVATE_BUCKET"]
                key_id = env.get("OGHMA_S3_PRIVATE_ACCESS_KEY_ID") or env["OGHMA_S3_ACCESS_KEY_ID"]
                secret = env.get("OGHMA_S3_PRIVATE_SECRET_ACCESS_KEY") or env["OGHMA_S3_SECRET_ACCESS_KEY"]
            else:
                self._bucket = env["OGHMA_S3_BUCKET"]
                key_id, secret = env["OGHMA_S3_ACCESS_KEY_ID"], env["OGHMA_S3_SECRET_ACCESS_KEY"]
            self._client = boto3.client(
                "s3",
                endpoint_url=env["OGHMA_S3_ENDPOINT"],
                region_name=env.get("OGHMA_S3_REGION"),
                aws_access_key_id=key_id,
                aws_secret_access_key=secret,
            )
        return self._client

    def get(self, key: str) -> bytes:
        client = self._ensure()
        return client.get_object(Bucket=self._bucket, Key=key)["Body"].read()

    def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
        client = self._ensure()
        client.put_object(Bucket=self._bucket, Key=key, Body=data, ContentType=content_type)

    def list(self, prefix: str) -> list[str]:
        client = self._ensure()
        keys: list[str] = []
        for page in client.get_paginator("list_objects_v2").paginate(Bucket=self._bucket, Prefix=prefix):
            keys.extend(obj["Key"] for obj in page.get("Contents", []))
        return keys

    def delete(self, keys: list[str]) -> None:
        client = self._ensure()
        for i in range(0, len(keys), 1000):
            client.delete_objects(Bucket=self._bucket, Delete={"Objects": [{"Key": k} for k in keys[i:i + 1000]]})


_store: BundleStore | None = None


def get_store() -> BundleStore:
    global _store
    if _store is None:
        _store = BundleStore()
    return _store


def set_store(store: BundleStore | None) -> None:
    """Troca o acesso ao B2 (testes)."""
    global _store
    _store = store


_private_store: BundleStore | None = None


def get_private_store() -> BundleStore | None:
    """Bucket privado (raw, backups) ou None se `OGHMA_S3_PRIVATE_BUCKET` nao estiver configurado."""
    global _private_store
    if _private_store is None and os.environ.get("OGHMA_S3_PRIVATE_BUCKET"):
        _private_store = BundleStore(private=True)
    return _private_store


def set_private_store(store: BundleStore | None) -> None:
    """Troca o acesso ao bucket privado (testes)."""
    global _private_store
    _private_store = store


# ------------------------------------------------------------------ estado da publicacao

def _storage_root() -> Path:
    return Path(get_settings().storage_root)


def load_publish_state(path: Path | None = None) -> dict:
    p = path or (_storage_root() / "publish_state.json")
    if not p.exists():
        return {"novels": {}, "sites": {}}
    return json.loads(p.read_text(encoding="utf-8"))


# ------------------------------------------------------------------ arquivos (funcoes puras)

def chapter_number_from_member(name: str) -> float | None:
    """`chapters/12.5.html` -> 12.5."""
    if not name.startswith("chapters/") or not name.endswith(".html"):
        return None
    try:
        return float(name[len("chapters/"):-len(".html")])
    except ValueError:
        return None


def extract_bundle(data: bytes, expected_sha: str | None, content_paths: dict[float, str],
                   asset_dir: Path, fallback_path) -> dict:
    """Escreve os capitulos e assets de um bundle de volta no disco.

    content_paths: numero do capitulo -> caminho de `content` registrado no banco.
    fallback_path(numero, html) -> caminho, para capitulo sem caminho no banco.
    """
    if expected_sha and hashlib.sha256(data).hexdigest() != expected_sha:
        raise ValueError("sha256 do bundle nao confere com o publish_state")
    chapters = assets = 0
    written: dict[float, str] = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            raw = tar.extractfile(member).read()
            number = chapter_number_from_member(member.name)
            if number is not None:
                html = raw.decode("utf-8")
                path = content_paths.get(number) or fallback_path(number, html)
                Path(path).parent.mkdir(parents=True, exist_ok=True)
                Path(path).write_text(html, encoding="utf-8")
                written[number] = path
                chapters += 1
            elif member.name.startswith("assets/"):
                name = Path(member.name).name
                if not name or name.startswith("."):
                    continue
                asset_dir.mkdir(parents=True, exist_ok=True)
                (asset_dir / name).write_bytes(raw)
                assets += 1
    return {"chapters": chapters, "assets": assets, "written": written}


def dir_bytes(path: Path) -> int:
    total = 0
    if path.exists():
        for root, _, files in os.walk(path):
            for f in files:
                try:
                    total += (Path(root) / f).stat().st_size
                except OSError:
                    pass
    return total


def delete_local(content_paths: list[str], asset_dir: Path) -> int:
    """Apaga content dos capitulos e a pasta de assets. Devolve bytes liberados."""
    freed = 0
    dirs: set[Path] = set()
    for p in content_paths:
        path = Path(p)
        if path.exists():
            freed += path.stat().st_size
            path.unlink()
            dirs.add(path.parent)
    freed += dir_bytes(asset_dir)
    if asset_dir.exists():
        shutil.rmtree(asset_dir)
    for d in dirs:
        try:
            d.rmdir()  # so se ficou vazia
        except OSError:
            pass
    return freed


@dataclass
class Candidate:
    novel_id: str
    last_new_chapter_at: datetime | None
    bytes: int
    published_current: bool


def choose_evictions(candidates: list[Candidate], usage_bytes: int, *, cap_bytes: int,
                     window_days: int, now: datetime) -> tuple[list[Candidate], int]:
    """Quais novels esfriar e com que janela.

    1. Sempre: novels publicadas e sem capitulo novo ha mais de `window_days`.
    2. Se o uso continuar acima do teto, encurta a janela ate MIN_WINDOW_DAYS.
    3. Se ainda passar, esfria as mais antigas primeiro (LRU) ate caber.
    Nunca esfria uma novel cujo bundle publicado nao esta atual.
    """
    eligible = [c for c in candidates if c.published_current]

    def older_than(c: Candidate, days: int) -> bool:
        return c.last_new_chapter_at is None or c.last_new_chapter_at < now - timedelta(days=days)

    window = window_days
    chosen = [c for c in eligible if older_than(c, window)]
    remaining = usage_bytes - sum(c.bytes for c in chosen)
    while remaining > cap_bytes and window > MIN_WINDOW_DAYS:
        window = max(MIN_WINDOW_DAYS, window - 15)
        chosen = [c for c in eligible if older_than(c, window)]
        remaining = usage_bytes - sum(c.bytes for c in chosen)
    if remaining > cap_bytes:
        picked = {c.novel_id for c in chosen}
        epoch = datetime.min.replace(tzinfo=timezone.utc)
        for c in sorted(eligible, key=lambda c: c.last_new_chapter_at or epoch):
            if remaining <= cap_bytes:
                break
            if c.novel_id in picked:
                continue
            chosen.append(c)
            picked.add(c.novel_id)
            remaining -= c.bytes
    return chosen, window


# ------------------------------------------------------------------ banco

def _asset_dir(source_id: str, slug: str) -> Path:
    from .storage import _safe

    return _storage_root() / "assets" / _safe(source_id) / _safe(slug)


async def _ok_chapters(session, novel_id: str):
    from sqlalchemy import select

    from .models import Chapter

    return (await session.scalars(
        select(Chapter).where(Chapter.novel_id == novel_id, Chapter.status == "ok")
    )).all()


async def ensure_hot(session, novel_id: str) -> bool:
    """Garante os arquivos locais da novel. Reidrata do B2 se ela estiver fria."""
    from .models import Novel
    from . import storage

    novel = await session.get(Novel, novel_id)
    if novel is None or (novel.storage_state or "hot") != "cold":
        return False
    info = load_publish_state()["novels"].get(novel_id)
    if not info:
        raise RuntimeError(f"{novel_id} esta fria mas nao tem bundle no publish_state")
    data = get_store().get(info["key"])
    chapters = await _ok_chapters(session, novel_id)
    paths = {float(c.number): c.content_path for c in chapters if c.content_path}

    def fallback(number: float, html: str) -> str:
        return storage.save_content(novel.source_id, novel.slug, number, html)

    result = extract_bundle(data, info.get("sha256"), paths, _asset_dir(novel.source_id, novel.slug), fallback)
    for c in chapters:
        written = result["written"].get(float(c.number))
        if written and c.content_path != written:
            c.content_path = written
    novel.storage_state = "hot"
    await session.commit()
    return True


async def evict(session, *, source_id: str | None = None, dry_run: bool = False,
                cap_gb: float | None = None, window_days: int = 60) -> dict:
    """Esfria novels publicadas e paradas; respeita o teto de disco (`OGHMA_HOT_CAP_GB`)."""
    from sqlalchemy import select

    from .models import Novel
    from .publish.hashing import content_hash
    from .publish.records import ChapterRecord

    cap = float(cap_gb if cap_gb is not None else os.environ.get("OGHMA_HOT_CAP_GB", DEFAULT_CAP_GB))
    root = _storage_root()
    usage = dir_bytes(root / "content") + dir_bytes(root / "assets")
    state = load_publish_state()["novels"]
    q = select(Novel).where(Novel.storage_state == "hot")
    if source_id:
        q = q.where(Novel.source_id == source_id)
    novels = (await session.scalars(q)).all()
    candidates: dict[str, tuple[Candidate, Novel, list]] = {}
    for n in novels:
        chapters = await _ok_chapters(session, n.id)
        records = [ChapterRecord(id=c.id, number=float(c.number), title=c.title, published_at=c.published_at,
                                 word_count=c.word_count, content_path=c.content_path, content_hash=c.content_hash)
                   for c in chapters if c.content_path and c.downloaded]
        published = state.get(n.id, {})
        current = bool(published) and published.get("content_hash") == content_hash(records)
        size = sum(Path(c.content_path).stat().st_size for c in chapters
                   if c.content_path and Path(c.content_path).exists())
        size += dir_bytes(_asset_dir(n.source_id, n.slug))
        candidates[n.id] = (Candidate(n.id, n.last_new_chapter_at, size, current), n, chapters)
    chosen, window = choose_evictions([c for c, _, _ in candidates.values()], usage,
                                      cap_bytes=int(cap * 1024 ** 3), window_days=window_days,
                                      now=datetime.now(timezone.utc))
    freed = 0
    if not dry_run:
        for cand in chosen:
            _, novel, chapters = candidates[cand.novel_id]
            freed += delete_local([c.content_path for c in chapters if c.content_path],
                                  _asset_dir(novel.source_id, novel.slug))
            novel.storage_state = "cold"
        await session.commit()
    return {
        "dry_run": dry_run, "source": source_id, "cap_gb": cap, "window_days": window,
        "usage_gb": round(usage / 1024 ** 3, 2), "hot_novels": len(novels),
        "not_published_current": sum(1 for c, _, _ in candidates.values() if not c.published_current),
        "evicted": len(chosen), "freed_bytes": freed if not dry_run else sum(c.bytes for c in chosen),
        "novels": [c.novel_id for c in chosen][:50],
    }


# ------------------------------------------------------------------ raw

def archive_raw(local_path: str) -> str | None:
    """Destino do HTML original depois de normalizado (`OGHMA_RAW_ARCHIVE`).

    keep (padrao): fica no disco. b2: sobe para `raw/...` do bucket privado e apaga local
    (sem `OGHMA_S3_PRIVATE_BUCKET`, fica no disco: nunca vai para o bucket publico).
    none: apaga local. Devolve o caminho/chave que fica registrado, ou None.
    """
    mode = os.environ.get("OGHMA_RAW_ARCHIVE", "keep").lower()
    path = Path(local_path)
    if mode == "keep" or not path.exists():
        return local_path
    if mode == "b2":
        store = get_private_store()
        if store is None:
            return local_path
        rel = path.relative_to(_storage_root()) if path.is_relative_to(_storage_root()) else Path("raw") / path.name
        key = str(rel) if str(rel).startswith("raw/") else f"raw/{rel}"
        store.put(key, path.read_bytes(), "application/gzip")
        path.unlink()
        return f"b2://{key}"
    path.unlink()
    return None
