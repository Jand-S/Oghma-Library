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


def test_restart_flag_drains_running_sources_and_exits():
    """Pedido de reinicio no meio da volta: as fontes em andamento terminam, as outras nao comecam."""
    deps, calls = make(["a", "b", "c", "d"], crawl_delay=0.05)
    flag = {"set": False, "cleared": 0}
    original_crawl = deps.crawl

    async def crawl(sid):
        if sid == "b":
            flag["set"] = True  # o autoconnector pede o reinicio com a e b ja rodando
        return await original_crawl(sid)

    deps.crawl = crawl
    deps.restart_requested = lambda: flag["set"]
    deps.clear_restart = lambda: flag.update(cleared=flag["cleared"] + 1)
    rod = Rodizio(deps, parallel=2)
    asyncio.run(asyncio.wait_for(rod.run(), timeout=5))  # sem once: so sai por causa do reinicio
    assert sorted(calls["crawl"]) == ["a", "b"]
    assert sorted(calls["publish"]) == sorted(calls["evict"]) == ["a", "b"]
    assert calls["stopped"] == [] and flag["cleared"] == 1


def test_restart_flag_during_pause_exits(monkeypatch):
    from oghma import rodizio

    monkeypatch.setattr(rodizio, "RESTART_POLL_SECONDS", 0.01)
    deps, calls = make(["a"])
    flag = {"set": False}

    async def long_sleep(_s):
        flag["set"] = True  # o pedido chega durante a pausa de 30 min
        await asyncio.sleep(10)

    deps.sleep = long_sleep
    deps.restart_requested = lambda: flag["set"]
    deps.clear_restart = lambda: flag.update(set=False)
    asyncio.run(asyncio.wait_for(Rodizio(deps).run(), timeout=2))
    assert calls["crawl"] == ["a"] and flag["set"] is False


def test_new_sources_first():
    from oghma.rodizio import order_sources

    assert order_sources(["a", "b", "c", "d"], {"a", "c"}) == ["b", "d", "a", "c"]


def test_failure_streak_ignores_stops_and_reboots():
    from oghma.rodizio import failure_streak

    runs = [("running", None), ("error", "403"), ("error", "parado: rodizio encerrado (SIGTERM/SIGINT)"),
            ("error", "morreu no reboot do xeonserver"), ("error", "timeout"), ("done", None), ("error", "x")]
    assert failure_streak(runs) == 2
    assert failure_streak([("done", None), ("error", "x")]) == 0


def test_crawl_error_stage_is_a_failure_and_third_disables():
    """crawl_source devolve stage=crawl_error sem levantar: nao publica, conta a falha, a 3a tira do rodizio."""
    deps, calls = make(["a", "b"], stats={"stage": "crawl_error", "last_event": "Client error '403 Forbidden'"})
    streak = {"a": 2, "b": 0}
    disabled = []

    async def failures(sid):
        streak[sid] += 1
        return streak[sid]

    async def disable(sid):
        disabled.append(sid)

    deps.failures, deps.disable = failures, disable
    log = []
    deps.notify = lambda lvl, title, body: log.append((lvl, title, body))
    rod = Rodizio(deps)
    asyncio.run(rod.run(once=True))
    assert calls["publish"] == [] and calls["evict"] == []
    assert disabled == ["a"]
    titles = {t.split(" ")[0].rstrip(":"): (lvl, t, b) for lvl, t, b in log}
    assert "saiu do rodízio" in titles["a"][1] and "source-enable a" in titles["a"][2]
    assert titles["b"][1].endswith("(falha 1 de 3)") and titles["b"][0] == "error"
