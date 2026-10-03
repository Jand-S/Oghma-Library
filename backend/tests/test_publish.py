"""Testes do publish que rodam so com stdlib (sqlite3/tarfile/gzip/json)."""
import json
import tarfile
import tempfile
from pathlib import Path

from oghma.publish.bundles import build_bundle, bundle_key
from oghma.publish.catalog import cover_key
from oghma.publish.covers import plan_covers
from oghma.publish.hashing import content_hash
from oghma.publish.records import ChapterRecord, NovelRecord
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


def test_catalog_publishes_normalized_fields_instead_of_raw_extra():
    import json
    from oghma.publish.catalog import build_catalog_json, public_fields
    from oghma.publish.records import SourceRecord

    n = _novel()
    n.extra = {"rating": 4.36, "ratings_count": 128, "views": 44758, "mahou_reader_id": 9, "cover_checked_at": "x",
               "source_chapter_count": 967}
    n.first_seen_at, n.last_new_chapter_at = "2026-06-01T00:00:00+00:00", "2026-10-03T20:21:00+00:00"
    src = SourceRecord(id="central-novel", name="Central", base_url="https://c/", novel_count=1, last_sync=None)
    row = json.loads(build_catalog_json(src, [n], {}))["novels"][0]
    assert "extra" not in row
    assert row["rating"] == 4.36 and row["ratingVotes"] == 128 and row["views"] == 44758
    assert row["firstSeenAt"].startswith("2026-06-01") and row["lastChapterAt"].startswith("2026-10-03")
    assert row["sourceChapterCount"] == 967
    # Escalas diferentes viram 0-5; 0 quer dizer sem dado.
    n.extra = {"rating": 9.0, "rating_votes": 3}
    assert public_fields(n)["rating"] == 4.5 and public_fields(n)["ratingVotes"] == 3
    n.extra = {"rating": 86}
    assert public_fields(n)["rating"] == 4.3
    n.extra = {"rating": 0, "views": 0}
    assert public_fields(n)["rating"] is None and public_fields(n)["views"] is None


def test_python_taxonomy_is_the_single_source_and_matches_the_app_labels():
    """O catalogo publica os rotulos do Python; o app tem uma lista de reserva. As duas nao podem divergir."""
    import re
    import unicodedata
    from oghma.taxonomy.tags import TAGS

    ts_file = Path(__file__).resolve().parents[2] / "apps" / "desktop" / "src" / "core" / "tagFilters.ts"
    if not ts_file.exists():  # backend copiado sozinho (ex.: VPS sem o app)
        return
    app_labels = dict(re.findall(r'key: "([^"]+)", label: "([^"]+)"', ts_file.read_text(encoding="utf-8")))
    py_labels = {tag.key: tag.label for tag in TAGS}
    assert set(app_labels) <= set(py_labels), "tag do app sem definicao no Python"
    assert {k: v for k, v in app_labels.items() if py_labels[k] != v} == {}
    # Rotulos em portugues com acento: nenhum "cao"/"coes" sem til sobrou.
    unaccented = [label for label in py_labels.values() if re.search(r"(cao|coes)\b", label)]
    assert unaccented == []
    assert all(unicodedata.is_normalized("NFC", label) for label in py_labels.values())
