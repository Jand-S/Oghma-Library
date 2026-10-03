from datetime import datetime, timedelta, timezone

import pytest

from oghma import coldstore, ops


class Store:
    def __init__(self):
        self.objects: dict[str, bytes] = {}

    def put(self, key, data, content_type="application/octet-stream"):
        self.objects[key] = data

    def list(self, prefix):
        return [k for k in self.objects if k.startswith(prefix)]

    def delete(self, keys):
        for k in keys:
            self.objects.pop(k)


def test_backup_keeps_newest_copies():
    store = Store()
    start = datetime(2026, 10, 1, tzinfo=timezone.utc)
    for day in range(5):
        ops.backup_db(keep=3, store=store, dump=lambda p: p.write_bytes(b"dump"), now=start + timedelta(days=day))
    assert sorted(store.objects) == [f"backups/db/2026-10-0{d}T0000.dump" for d in (3, 4, 5)]


def test_backup_refuses_without_private_bucket(monkeypatch):
    monkeypatch.delenv("OGHMA_S3_PRIVATE_BUCKET", raising=False)
    coldstore.set_private_store(None)
    with pytest.raises(RuntimeError):
        ops.backup_db(dump=lambda p: p.write_bytes(b"x"))


def test_disk_check_warns_over_hot_cap(tmp_path, monkeypatch):
    (tmp_path / "content").mkdir()
    (tmp_path / "content" / "a.html").write_bytes(b"x" * 1000)
    sent = []
    monkeypatch.setenv("OGHMA_HOT_CAP_GB", str(1000 / 1024**3))
    report = ops.disk_check(root=tmp_path, disk_limit=1.01, notify=lambda *a, **k: sent.append(a))
    assert report["warned"] and sent and "teto" in sent[0][2]
    monkeypatch.setenv("OGHMA_HOT_CAP_GB", "20")
    sent.clear()
    assert not ops.disk_check(root=tmp_path, disk_limit=1.01, notify=lambda *a, **k: sent.append(a))["warned"] and not sent
