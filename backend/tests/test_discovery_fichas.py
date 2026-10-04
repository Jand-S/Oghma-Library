import json

from oghma.discovery.fichas import PlanLimit, batch_payload, generate, parse_fichas, pending, source_hash
from oghma.discovery.similar import DiscoveryNovel


def nv(id, title="T", description="Uma sinopse."):
    return DiscoveryNovel(id=id, source_id="s", title=title, language="pt-BR", description=description,
                          tags=["Ação"], author="A")


def answer(novels, **extra):
    return json.dumps([{"id": n.id, "known": False, "protagonista": "p", "premissa": "x", "mundo": "m", "tom": "t",
                        "estrutura": "e", "tracos": ["a", "b", "c"], **extra} for n in novels])


def test_only_missing_or_changed_novels_are_pending():
    a, b, c = nv("a"), nv("b"), nv("c", description="Nova sinopse.")
    fichas = {"a": {"premissa": "x", "_src": source_hash(a)}, "b": {"premissa": "piloto, sem _src"},
              "c": {"premissa": "x", "_src": source_hash(nv("c"))}}
    assert [n.id for n in pending([a, b, c, nv("d")], fichas)] == ["c", "d"]


def test_parse_keeps_known_ids_with_content_and_marks_the_input():
    novels = [nv("a"), nv("b")]
    text = "Aqui está:\n" + answer(novels)[:-1] + ', {"id": "zz", "premissa": "inventada"}, {"id": "b"}]'
    out = parse_fichas(text, novels)
    assert set(out) == {"a", "b"} and out["a"]["_src"] == source_hash(novels[0])
    assert parse_fichas("[{\"id\": \"a\"}]", novels) == {}
    assert parse_fichas("não sei", novels) == {}
    assert '"synopsis": "Uma sinopse."' in batch_payload(novels)


def test_generate_saves_after_each_batch_and_stops_at_the_plan_limit(tmp_path):
    novels = [nv(f"n{i}") for i in range(45)]
    path = tmp_path / "fichas.json"
    calls = []

    def run(task, workdir):
        batch = [n for n in novels if f'"id": "{n.id}"' in task]
        calls.append(len(batch))
        return answer(batch), {"input": 10, "cached": 5, "output": 2}

    checks = iter([None, None, PlanLimit("plano em 90%")])

    def check():
        result = next(checks)
        if result:
            raise result

    out = generate(novels, path, run=run, check=check, log=lambda *_: None)
    assert calls == [20, 20]
    assert out["written"] == 40 and out["stopped"] == "plano em 90%" and out["usage"]["input"] == 20
    assert len(json.loads(path.read_text())) == 40
    # Next round picks up where it stopped.
    again = generate(novels, path, run=run, check=lambda: None, log=lambda *_: None)
    assert again["pending"] == 5 and again["total"] == 45
