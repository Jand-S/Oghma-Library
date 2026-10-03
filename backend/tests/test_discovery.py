import numpy as np
import pytest

from oghma.discovery.similar import (DiscoveryNovel, EmbeddingCache, build_discovery, embed, ficha_text, novel_text,
                                     work_key)
from oghma.publish.runner import _index_from_state
from oghma.publish.uploader import IMMUTABLE, cache_control_for


def nv(id, title, source="central-novel", tags=(), description="x" * 250):
    return DiscoveryNovel(id=id, source_id=source, title=title, language="pt-BR", description=description,
                          tag_keys=list(tags))


def unit(*rows):
    m = np.array(rows, dtype=np.float32)
    return m / np.linalg.norm(m, axis=1, keepdims=True)


def test_work_key_matches_the_app():
    assert work_key("Shadow Slave (Novel)") == "shadow slave"
    assert work_key("Ascensão de Aço [WN]") == "ascensao de aco"


def test_similar_ranks_by_story_then_tags_and_leaves_out_the_same_work():
    novels = [
        nv("a", "Shadow Slave", tags=["genre.fantasy", "theme.monsters"]),
        nv("a2", "Shadow Slave (Novel)", source="rolia-scan", tags=["genre.fantasy"]),
        nv("b", "Lord of the Mysteries", tags=["genre.fantasy", "theme.mystery"]),
        nv("c", "Amor de Verão", tags=["genre.romance"]),
    ]
    story = unit([1, 0.1, 0], [1, 0.1, 0], [0.9, 0.3, 0], [0, 0, 1])
    synopsis = unit([1, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1])
    out = build_discovery(novels, story, synopsis, top_k=5)
    assert [i for i, _ in out["similar"]["a"]] == ["b", "c"]
    assert out["editions"]["a"] == ["a2"]


def test_same_work_in_another_language_is_an_edition_not_a_suggestion():
    novels = [nv("ce", "Classroom of the Elite"), nv("ce-pt", "A Classe de Elite", source="novel-mania"),
              nv("x", "Outra")]
    synopsis = unit([1, 0.02, 0], [1, 0, 0], [0, 0, 1])
    out = build_discovery(novels, synopsis, synopsis, top_k=5)
    assert out["editions"]["ce"] == ["ce-pt"]
    assert [i for i, _ in out["similar"]["ce"]] == ["x"]
    # Short synopses match by chance: they never make an edition.
    short = [nv("p", "Um", description="curta"), nv("q", "Dois", source="novel-mania", description="curta")]
    assert build_discovery(short, unit([1, 0], [1, 0]), unit([1, 0], [1, 0]))["editions"] == {}


def test_ficha_wins_over_the_synopsis():
    novel = nv("a", "Shadow Slave", description="<p>Sunny é escolhido pelo Feitiço do Pesadelo.</p>")
    assert novel_text(novel) == "Sunny é escolhido pelo Feitiço do Pesadelo."
    ficha = {"protagonista": "Sunny", "premissa": "Feitiço do Pesadelo", "tracos": ["sombra", "não mente"]}
    assert novel_text(novel, ficha) == ficha_text(ficha)
    assert "Traços: sombra; não mente" in ficha_text(ficha)


def test_embed_only_runs_the_model_for_new_texts(tmp_path):
    class Fake:
        calls = []

        def embed(self, texts, batch_size=32):
            self.calls.append(list(texts))
            return [np.array([len(t), 1.0]) for t in texts]

    fake = Fake()
    cache = EmbeddingCache(tmp_path)
    vecs, keys = embed(["a", "bb"], "m", cache, fake)
    assert vecs.shape == (2, 2) and np.allclose(np.linalg.norm(vecs, axis=1), 1)
    cache.save(keys)
    again = EmbeddingCache(tmp_path)
    again.load()
    embed(["a", "bb", "ccc"], "m", again, fake)
    assert fake.calls == [["a", "bb"], ["ccc"]]


def test_index_points_at_the_discovery_file_and_it_is_immutable():
    state = {"sites": {"x": {"id": "x"}}, "discovery": {"similarKey": "discovery/similar-1.json.gz", "similarSha256": "ab"}}
    assert _index_from_state(state)["discovery"]["similarKey"] == "discovery/similar-1.json.gz"
    assert "discovery" not in _index_from_state({"sites": {}})
    assert cache_control_for("discovery/similar-1.json.gz") == IMMUTABLE
