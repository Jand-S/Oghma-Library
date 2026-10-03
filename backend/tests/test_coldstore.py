"""Armazenamento quente/frio: evict -> rehydrate byte a byte, teto/LRU, first_seen_at e raw."""
import asyncio
import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from oghma import coldstore
from oghma.coldstore import Candidate, choose_evictions, delete_local, extract_bundle
from oghma.publish.bundles import build_bundle
from oghma.publish.records import ChapterRecord, NovelRecord
from oghma.scraper import orchestrator

NOW = datetime(2026, 10, 3, tzinfo=timezone.utc)
GB = 1024 ** 3


class FakeStore:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def get(self, key):
        return self.objects[key]

    def put(self, key, data, content_type="application/octet-stream"):
        self.objects[key] = data


def _bundle(tmp_path: Path):
    content = tmp_path / "content" / "src" / "novel"
    content.mkdir(parents=True)
    assets = tmp_path / "assets" / "src" / "novel"
    assets.mkdir(parents=True)
    chapters = {1.0: "<p>um ç</p>", 2.5: '<p>dois</p><img src="../assets/a.webp">'}
    records = []
    for n, html in chapters.items():
        path = content / f"{n}.html"
        path.write_text(html, encoding="utf-8")
        records.append(ChapterRecord(id=f"src:novel#{n:g}", number=n, title=f"C{n:g}", published_at=None,
                                     word_count=1, content_path=str(path), content_hash=f"h{n}"))
    (assets / "a.webp").write_bytes(b"\x00\x01imagem")
    novel = NovelRecord(id="src:novel", source_id="src", slug="novel", title="N", author=None, description=None,
                        cover_path=None, language="pt-BR", status="ongoing", tags=[], tag_keys=[],
                        updated_at=None, chapters=records)
    out = tmp_path / "b.tar.gz"
    sha, _ = build_bundle(str(out), novel, 1, asset_dir=str(assets))
    return out.read_bytes(), sha, {r.number: r.content_path for r in records}, assets


def test_evict_then_rehydrate_restores_files_byte_for_byte(tmp_path):
    data, sha, paths, assets = _bundle(tmp_path)
    before = {p: Path(p).read_bytes() for p in paths.values()}
    asset_before = (assets / "a.webp").read_bytes()

    freed = delete_local(list(paths.values()), assets)
    assert freed > 0 and not any(Path(p).exists() for p in paths.values()) and not assets.exists()

    result = extract_bundle(data, sha, paths, assets, lambda n, h: pytest.fail("caminho do banco existe"))
    assert result["chapters"] == 2 and result["assets"] == 1
    assert {p: Path(p).read_bytes() for p in paths.values()} == before
    assert (assets / "a.webp").read_bytes() == asset_before


def test_rehydrate_refuses_wrong_sha(tmp_path):
    data, _, paths, assets = _bundle(tmp_path)
    with pytest.raises(ValueError, match="sha256"):
        extract_bundle(data, "0" * 64, paths, assets, lambda n, h: "")


def test_rehydrate_uses_fallback_for_chapter_without_path(tmp_path):
    data, sha, paths, assets = _bundle(tmp_path)
    extra = tmp_path / "novo" / "1.0.html"
    result = extract_bundle(data, sha, {2.5: paths[2.5]}, assets, lambda n, h: str(extra))
    assert extra.read_text(encoding="utf-8") == "<p>um ç</p>" and result["written"][1.0] == str(extra)


def _cand(i, days, gb, current=True):
    return Candidate(f"n{i}", None if days is None else NOW - timedelta(days=days), int(gb * GB), current)


def test_choose_only_old_and_published():
    cands = [_cand(1, 90, 1), _cand(2, 10, 1), _cand(3, 200, 1, current=False), _cand(4, None, 1)]
    chosen, window = choose_evictions(cands, 4 * GB, cap_bytes=20 * GB, window_days=60, now=NOW)
    assert {c.novel_id for c in chosen} == {"n1", "n4"} and window == 60


def test_cap_shortens_window_then_lru():
    cands = [_cand(1, 45, 5), _cand(2, 35, 5), _cand(3, 20, 5), _cand(4, 5, 5)]
    # 20 GB em uso e teto de 12: janela cai para 30 (sai n1 e n2 -> 10 GB) e basta.
    chosen, window = choose_evictions(cands, 20 * GB, cap_bytes=12 * GB, window_days=60, now=NOW)
    assert {c.novel_id for c in chosen} == {"n1", "n2"} and window == 30
    # Teto de 4: ainda falta, entra a mais antiga das restantes (n3) por LRU.
    chosen, _ = choose_evictions(cands, 20 * GB, cap_bytes=4 * GB, window_days=60, now=NOW)
    assert [c.novel_id for c in chosen][:2] == ["n1", "n2"] and "n3" in {c.novel_id for c in chosen}


def test_first_seen_set_only_on_create(monkeypatch):
    rows = {}

    class Session:
        def add(self, obj):
            rows[obj.id] = obj

        async def get(self, model, key):
            if model is orchestrator.Novel:
                return SimpleNamespace(last_new_chapter_at=None)
            return rows.get(key)

    t1 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    monkeypatch.setattr(orchestrator, "_now", lambda: t1)
    cref = SimpleNamespace(number=1.0, title="C1", url="https://x/1", published_at=None)
    norm = SimpleNamespace(text_hash="h", word_count=10)
    ch = asyncio.run(orchestrator._upsert_chapter(Session(), "s:n#1", "s:n", cref, norm, None, "/c"))
    assert ch.first_seen_at == t1
    monkeypatch.setattr(orchestrator, "_now", lambda: t1 + timedelta(days=5))
    asyncio.run(orchestrator._upsert_chapter(Session(), "s:n#1", "s:n", cref, norm, None, "/c"))
    assert ch.first_seen_at == t1 and ch.fetched_at == t1 + timedelta(days=5)


def test_raw_archive_modes(tmp_path, monkeypatch):
    monkeypatch.setattr(coldstore, "_storage_root", lambda: tmp_path)
    public, store = FakeStore(), FakeStore()
    coldstore.set_store(public)
    coldstore.set_private_store(None)
    monkeypatch.delenv("OGHMA_S3_PRIVATE_BUCKET", raising=False)
    try:
        raw = tmp_path / "raw" / "src" / "n" / "1.0.html.gz"
        raw.parent.mkdir(parents=True)
        raw.write_bytes(b"gz")
        monkeypatch.setenv("OGHMA_RAW_ARCHIVE", "keep")
        assert coldstore.archive_raw(str(raw)) == str(raw) and raw.exists()
        monkeypatch.setenv("OGHMA_RAW_ARCHIVE", "b2")
        # sem bucket privado: fica no disco, nunca no bucket publico
        assert coldstore.archive_raw(str(raw)) == str(raw) and raw.exists() and not public.objects
        coldstore.set_private_store(store)
        assert coldstore.archive_raw(str(raw)) == "b2://raw/src/n/1.0.html.gz"
        assert not raw.exists() and store.objects["raw/src/n/1.0.html.gz"] == b"gz" and not public.objects
        raw.write_bytes(b"gz")
        monkeypatch.setenv("OGHMA_RAW_ARCHIVE", "none")
        assert coldstore.archive_raw(str(raw)) is None and not raw.exists()
    finally:
        coldstore.set_store(None)
        coldstore.set_private_store(None)


def test_ensure_hot_rehydrates_from_store(tmp_path, monkeypatch):
    data, sha, paths, assets = _bundle(tmp_path)
    delete_local(list(paths.values()), assets)
    monkeypatch.setattr(coldstore, "_storage_root", lambda: tmp_path)
    (tmp_path / "publish_state.json").write_text(json.dumps(
        {"novels": {"src:novel": {"key": "content/src/novel/novel.v1.tar.gz", "sha256": sha}}, "sites": {}}))
    store = FakeStore()
    store.put("content/src/novel/novel.v1.tar.gz", data)
    coldstore.set_store(store)
    novel = SimpleNamespace(id="src:novel", source_id="src", slug="novel", storage_state="cold")
    chapters = [SimpleNamespace(number=n, content_path=p) for n, p in paths.items()]

    class Session:
        async def get(self, model, key):
            return novel

        async def commit(self):
            pass

    async def fake_ok(session, novel_id):
        return chapters

    monkeypatch.setattr(coldstore, "_ok_chapters", fake_ok)
    try:
        assert asyncio.run(coldstore.ensure_hot(Session(), "src:novel")) is True
        assert novel.storage_state == "hot" and all(Path(p).exists() for p in paths.values())
        assert (tmp_path / "assets" / "src" / "novel" / "a.webp").exists()
        assert asyncio.run(coldstore.ensure_hot(Session(), "src:novel")) is False  # ja quente
    finally:
        coldstore.set_store(None)
