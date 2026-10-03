"""Estado da publicacao atomico, erro em arquivo corrompido, trava unica e prune seguro."""
import json
import threading
import time
from pathlib import Path

import pytest

from oghma.publish.prune import plan_prune, prune, referenced_keys
from oghma.publish.state import LockTimeout, StateError, load_state, publish_lock, save_state


def test_missing_state_is_new(tmp_path):
    assert load_state(str(tmp_path / "s.json")) == {"novels": {}, "sites": {}}


def test_corrupt_state_fails_loudly(tmp_path):
    p = tmp_path / "s.json"
    p.write_text("{nao e json")
    with pytest.raises(StateError):
        load_state(str(p))


def test_save_state_is_atomic_and_leaves_no_temp(tmp_path):
    p = tmp_path / "s.json"
    save_state(str(p), {"novels": {"a": {"version": 1}}, "sites": {}})
    save_state(str(p), {"novels": {"a": {"version": 2}}, "sites": {}})
    assert json.loads(p.read_text())["novels"]["a"]["version"] == 2
    assert [x.name for x in tmp_path.iterdir()] == ["s.json"]


def test_save_state_failure_keeps_old_file(tmp_path):
    p = tmp_path / "s.json"
    save_state(str(p), {"novels": {}, "sites": {"x": 1}})
    with pytest.raises(TypeError):
        save_state(str(p), {"bad": object()})
    assert json.loads(p.read_text())["sites"] == {"x": 1}
    assert len(list(tmp_path.iterdir())) == 1


def test_publish_lock_serializes_and_times_out(tmp_path):
    lock = str(tmp_path / "publish.lock")
    order = []

    def holder():
        with publish_lock(lock):
            order.append("a-in")
            time.sleep(0.4)
            order.append("a-out")

    t = threading.Thread(target=holder)
    t.start()
    time.sleep(0.1)
    with pytest.raises(LockTimeout):
        with publish_lock(lock, timeout=0.1, poll=0.05, log=lambda *_: None):
            pass
    with publish_lock(lock, timeout=5, poll=0.05, log=lambda *_: None):
        order.append("b-in")
    t.join()
    assert order == ["a-in", "a-out", "b-in"]


STATE = {
    "novels": {"cn:a": {"key": "content/cn/a/a.v3.tar.gz"}, "cn:b": {"key": "content/cn/b/b.v1.tar.gz"}},
    "sites": {"cn": {"catalogKey": "catalog/cn-20260901-000000.sqlite.gz",
                     "catalogJsonKey": "catalog/cn-20260901-000000.json.gz"}},
}


def test_prune_keeps_recent_and_never_referenced():
    keys = [f"content/cn/a/a.v{v}.tar.gz" for v in (1, 2, 3, 4, 5)] + ["content/cn/b/b.v1.tar.gz"]
    keys += [f"catalog/cn-2026090{d}-000000.json.gz" for d in (1, 2, 3, 4)]
    keys += [f"catalog/cn-2026090{d}-000000.sqlite.gz" for d in (1, 2, 3, 4)]
    doomed = plan_prune(keys, STATE, keep=2)
    assert not set(doomed) & referenced_keys(STATE)
    # mantem v5 e v4 (mais novas) + v3 (referenciada); apaga v1 e v2
    assert {k for k in doomed if k.startswith("content/")} == {"content/cn/a/a.v1.tar.gz", "content/cn/a/a.v2.tar.gz"}
    # catalogo de 01/09 e o atual: fica; 02/09 sai
    assert "catalog/cn-20260902-000000.json.gz" in doomed
    assert "catalog/cn-20260901-000000.json.gz" not in doomed


def test_prune_filters_source_and_reports_bytes(tmp_path):
    for key in ["content/cn/a/a.v1.tar.gz", "content/cn/a/a.v2.tar.gz", "content/cn/a/a.v3.tar.gz",
                "content/gn/x/x.v1.tar.gz", "content/gn/x/x.v2.tar.gz", "content/gn/x/x.v3.tar.gz"]:
        f = tmp_path / key
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"x" * 10)

    class Up:
        deleted = []

        def delete_keys(self, keys):
            self.deleted.extend(keys)
            return len(keys)

    up = Up()
    remote = {"content/cn/a/a.v1.tar.gz": 100, "content/cn/a/a.v2.tar.gz": 100, "content/cn/a/a.v3.tar.gz": 100}
    dry = prune(STATE, work_dir=tmp_path, remote=remote, uploader=up, keep=1, source="cn", dry_run=True)
    assert dry["local"]["files"] == 2 and up.deleted == []  # fica so a v3 (mais nova e referenciada)
    rep = prune(STATE, work_dir=tmp_path, remote=remote, uploader=up, keep=1, source="cn")
    assert rep["remote"] == {"files": 2, "bytes": 200}
    assert sorted(up.deleted) == ["content/cn/a/a.v1.tar.gz", "content/cn/a/a.v2.tar.gz"]
    assert not (tmp_path / "content/cn/a/a.v1.tar.gz").exists()
    assert (tmp_path / "content/gn/x/x.v1.tar.gz").exists()  # outra fonte intacta
