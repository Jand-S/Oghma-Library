"""Testes do publish que rodam so com stdlib (sqlite3/tarfile/gzip/json)."""
import gzip
import json
import sqlite3
import tarfile
import tempfile
from pathlib import Path

from oghma.publish.bundles import build_bundle, bundle_key
from oghma.publish.catalog import build_catalog, cover_key
from oghma.publish.covers import plan_covers
from oghma.publish.hashing import content_hash
from oghma.publish.records import ChapterRecord, NovelRecord, SourceRecord
from oghma.publish.runner import _index_from_state


def _novel(with_cover=True):
    chs = [
        ChapterRecord(id="n#1", number=1.0, title="Cap 1", published_at=None, word_count=10,
                      content_path="/fake/1.html", content_hash="h1"),
        ChapterRecord(id="n#10.5", number=10.5, title="Cap 10.5", published_at=None, word_count=20,
                      content_path="/fake/10_5.html", content_hash="h2"),
    ]
    return NovelRecord(
        id="central-novel:supreme-magus", source_id="central-novel", slug="supreme-magus",
        title="Supreme Magus", author="JKLLAS", description="desc", language="pt-BR", status="ongoing",
        tags=["Fantasia", "Aventura"], tag_keys=["genre.fantasy", "genre.adventure"],
        updated_at="2026-06-16T00:00:00Z",
        cover_path=("/srv/oghma/covers/central-novel/supreme-magus.jpg" if with_cover else None),
        chapters=chs,
    )


def test_content_hash_changes():
    n = _novel()
    h1 = content_hash(n.chapters)
    assert len(h1) == 64
    n.chapters[0].content_hash = "DIFERENTE"
    assert content_hash(n.chapters) != h1


def test_cover_key_relative():
    n = _novel()
    assert cover_key(n) == "covers/central-novel/supreme-magus.jpg"
    assert cover_key(_novel(with_cover=False)) is None


def test_build_bundle_and_meta():
    n = _novel()
    reader = {"/fake/1.html": "<p>um</p>", "/fake/10_5.html": "<p>dois</p>"}
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "b.tar.gz"
        sha, size = build_bundle(str(out), n, version=1, read_content=lambda p: reader[p])
        assert len(sha) == 64 and size > 0
        with tarfile.open(out, "r:gz") as tar:
            names = tar.getnames()
            assert "meta.json" in names
            assert "chapters/1.html" in names and "chapters/10.5.html" in names
            meta = json.loads(tar.extractfile("meta.json").read())
            assert meta["bundle_version"] == 1 and len(meta["chapters"]) == 2
            assert tar.extractfile("chapters/1.html").read() == b"<p>um</p>"
    assert bundle_key(n, 3) == "content/central-novel/supreme-magus/supreme-magus.v3.tar.gz"


def test_build_bundle_embeds_localized_chapter_assets():
    n = _novel()
    reader = {
        "/fake/1.html": '<p><img src="../assets/abc123.webp"></p>',
        "/fake/10_5.html": "<p>sem imagem</p>",
    }
    with tempfile.TemporaryDirectory() as d:
        asset_dir = Path(d) / "assets"
        asset_dir.mkdir()
        (asset_dir / "abc123.webp").write_bytes(b"RIFFxxxxWEBPimage")
        out = Path(d) / "bundle.tar.gz"
        build_bundle(
            str(out),
            n,
            version=1,
            read_content=lambda path: reader[path],
            asset_dir=str(asset_dir),
        )
        with tarfile.open(out, "r:gz") as tar:
            assert "assets/abc123.webp" in tar.getnames()
            assert tar.extractfile("assets/abc123.webp").read() == b"RIFFxxxxWEBPimage"


def test_build_catalog_readback():
    n = _novel()
    src = SourceRecord(id="central-novel", name="Central Novel", base_url="https://centralnovel.com/",
                       novel_count=1, last_sync="2026-06-16T00:00:00Z")
    binfo = {n.id: {"key": "content/x", "version": 1, "sha256": "abc", "bytes": 123}}
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "catalog.sqlite"
        build_catalog(str(out), src, [n], binfo)
        conn = sqlite3.connect(str(out))
        try:
            row = conn.execute(
                "SELECT title, cover_url, tags, tag_keys, chapter_count, bundle_key, bundle_version FROM novel WHERE id=?",
                (n.id,),
            ).fetchone()
            assert row[0] == "Supreme Magus"
            assert row[1] == "covers/central-novel/supreme-magus.jpg"
            assert json.loads(row[2]) == ["Fantasia", "Aventura"]
            assert json.loads(row[3]) == ["genre.fantasy", "genre.adventure"]
            assert row[4] == 2 and row[5] == "content/x" and row[6] == 1
            assert conn.execute("SELECT COUNT(*) FROM chapter WHERE novel_id=?", (n.id,)).fetchone()[0] == 2
            assert conn.execute("SELECT novel_count FROM source").fetchone()[0] == 1
            # FTS (se disponivel)
            try:
                hit = conn.execute("SELECT novel_id FROM novel_fts WHERE novel_fts MATCH 'supreme'").fetchall()
                assert (n.id,) in hit
                fts = "ok"
            except sqlite3.OperationalError:
                fts = "indisponivel"
            print("FTS5:", fts)
        finally:
            conn.close()


def test_plan_covers():
    plan = plan_covers([_novel(), _novel(with_cover=False)])
    assert len(plan) == 1
    assert plan[0]["key"] == "covers/central-novel/supreme-magus.jpg"
    assert plan[0]["content_type"] == "image/jpeg"


def test_index_from_state_keeps_multiple_sites():
    state = {
        "novels": {},
        "sites": {
            "central-novel": {
                "id": "central-novel",
                "name": "Central Novel",
                "catalogKey": "catalog/central.sqlite.gz",
                "catalogVersion": 3,
            },
            "novel-mania": {
                "id": "novel-mania",
                "name": "Novel Mania",
                "catalogKey": "catalog/novel-mania.sqlite.gz",
                "catalogVersion": 1,
            },
        },
    }

    index = _index_from_state(state)

    assert index["schema"] == 1
    assert {site["id"] for site in index["sites"]} == {"central-novel", "novel-mania"}
    assert len(index["sites"]) == 2


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for fn in fns:
        fn()
        print("ok:", fn.__name__)
    print(f"\n{len(fns)} passed")


def test_changed_or_late_covers_are_uploaded_once(tmp_path):
    from oghma.publish.covers import plan_changed_covers

    cover = tmp_path / "supreme-magus.jpg"
    cover.write_bytes(b"capa-1")
    n = _novel()
    n.cover_path = str(cover)
    state: dict = {}
    first = plan_changed_covers([n, _novel(with_cover=False)], state)
    assert [c["key"] for c in first] == ["covers/central-novel/supreme-magus.jpg"]
    state[n.id] = {"cover_sha256": first[0]["sha256"]}
    assert plan_changed_covers([n], state) == []  # nada mudou: nao reenvia
    cover.write_bytes(b"capa-2")  # o crawler trocou a capa: reenvia mesmo sem capitulo novo
    assert len(plan_changed_covers([n], state)) == 1


def test_cache_control_by_key():
    from oghma.publish.uploader import IMMUTABLE, cache_control_for

    assert cache_control_for("index.json") == "no-cache"
    assert cache_control_for("catalog/x-20261003.json.gz") == IMMUTABLE
    assert cache_control_for("content/x/y/y.v2.tar.gz") == IMMUTABLE
    assert cache_control_for("sources/novellunar-abc.png") == IMMUTABLE
    assert cache_control_for("covers/x/y.jpg") == "public, max-age=86400"
