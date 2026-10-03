"""Rodizio com dependencias falsas: Semaphore, publica + evict por fonte, avisos e parada limpa."""
import asyncio

from oghma.rodizio import Deps, Rodizio, summarize


def make(sources, *, crawl_delay=0.05, fail=(), stats=None):
    calls = {"crawl": [], "publish": [], "evict": [], "stopped": [], "notes": [], "active": 0, "peak": 0}

    async def list_sources():
        return list(sources)

    async def crawl(sid):
        calls["active"] += 1
        calls["peak"] = max(calls["peak"], calls["active"])
        calls["crawl"].append(sid)
        try:
            await asyncio.sleep(crawl_delay)
            if sid in fail:
                raise RuntimeError("Client error '403 Forbidden' for url")
            return dict(stats or {"chapters_new": 3, "chapters_invalid": 0, "novels_done": 1, "novels_total": 1})
        finally:
            calls["active"] -= 1

    async def publish(sid):
        calls["publish"].append(sid)
        return {"ok": True}

    async def evict(sid):
        calls["evict"].append(sid)
        return {"evicted": 0}

    async def mark_stopped(sid):
        calls["stopped"].append(sid)

    async def sleep(_s):
        await asyncio.sleep(0)

    deps = Deps(list_sources, crawl, publish, evict, mark_stopped,
                notify=lambda lvl, title, body: calls["notes"].append((lvl, title)), sleep=sleep)
    return deps, calls


def test_semaphore_and_per_source_publish_and_evict():
    deps, calls = make(["a", "b", "c", "d", "e"])
    asyncio.run(Rodizio(deps, parallel=2).run(once=True))
    assert calls["peak"] == 2
    assert sorted(calls["publish"]) == sorted(calls["evict"]) == ["a", "b", "c", "d", "e"]
    assert all(lvl == "success" for lvl, _ in calls["notes"])


def test_publish_disabled_still_evicts():
    deps, calls = make(["a"])
    asyncio.run(Rodizio(deps, publish_enabled=False).run(once=True))
    assert calls["publish"] == [] and calls["evict"] == ["a"]


def test_failing_source_notifies_error_and_others_continue():
    deps, calls = make(["a", "b"], fail={"a"})
    asyncio.run(Rodizio(deps).run(once=True))
    assert calls["publish"] == ["b"]
    assert ("error", "a: bloqueado (403)") in calls["notes"]


def test_only_filter():
    deps, calls = make(["a", "b", "c"])
    asyncio.run(Rodizio(deps).run(once=True, only=["b"]))
    assert calls["crawl"] == ["b"]


def test_stop_cancels_running_sources_and_marks_them():
    deps, calls = make(["a", "b", "c"], crawl_delay=5)

    async def scenario():
        rod = Rodizio(deps, parallel=2)
        task = asyncio.create_task(rod.run())
        await asyncio.sleep(0.1)
        rod.stop()
        try:
            await asyncio.wait_for(task, 2)
        except asyncio.CancelledError:
            pass

    asyncio.run(scenario())
    assert sorted(calls["stopped"]) == ["a", "b"]
    assert calls["publish"] == [] and "c" not in calls["crawl"]


def test_stop_wakes_the_pause_between_rounds():
    deps, calls = make(["a"])

    async def long_sleep(_s):
        await asyncio.sleep(30)

    deps.sleep = long_sleep

    async def scenario():
        rod = Rodizio(deps, pause_minutes=60)
        task = asyncio.create_task(rod.run())
        await asyncio.sleep(0.3)
        rod.stop()
        await asyncio.wait_for(task, 2)

    asyncio.run(scenario())
    assert calls["crawl"] == ["a"]


def test_summarize_levels():
    assert summarize("x", {"chapters_new": 0}, None)[0] == "info"
    assert summarize("x", {"chapters_new": 2, "chapters_invalid": 1}, None)[0] == "warn"
    assert summarize("x", None, "boom")[0] == "error"
