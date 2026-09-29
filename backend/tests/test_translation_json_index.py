from concurrent.futures import ThreadPoolExecutor

from oghma.translation.json_index import mutate_json_index, read_json_index


def test_mutate_json_index_keeps_concurrent_updates(tmp_path):
    path = tmp_path / "index.json"

    def increment(_):
        def mutate(raw):
            current = raw if isinstance(raw, dict) else {}
            return {"count": int(current.get("count", 0)) + 1}

        mutate_json_index(path, mutate)

    with ThreadPoolExecutor(max_workers=8) as pool:
        list(pool.map(increment, range(40)))

    assert read_json_index(path) == {"count": 40}
