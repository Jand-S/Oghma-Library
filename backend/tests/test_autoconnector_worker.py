"""Worker do autoconnector com motor falso: ordem dos subagentes, laco de correcao,
troca de motor quando o plano acaba e escolha pelo plano mais livre."""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "autoconnector"))

import engines  # noqa: E402
import worker  # noqa: E402
from engines import Engine, LimitHit, PlanUsage, RunResult, pick_engine  # noqa: E402


class FakeEngine(Engine):
    def __init__(self, name, five_hour=10.0, weekly=5.0, limit_on=(), approve_after=0, calls=None):
        self.name = name
        self.usage = PlanUsage(five_hour=five_hour, weekly=weekly)
        self.limit_on = set(limit_on)
        self.approve_after = approve_after
        self.calls = calls if calls is not None else []

    def available(self):
        return True

    def plan(self, fresh=False):
        return self.usage

    def run(self, role, system_prompt, task, cwd, *, timeout, network):
        if role in self.limit_on:
            self.limit_on.discard(role)
            raise LimitHit(f"{self.name} sem plano")
        self.calls.append((self.name, role))
        work = Path(cwd) / "backend" / "autoconnector" / "work"
        if role == "site-analyst":
            (work / "SITE_REPORT.md").write_text("# Resumo\nWordPress com wp-json.")
        if role == "qa-reviewer":
            reviews = sum(1 for _, r in self.calls if r == "qa-reviewer")
            verdict = "approve" if reviews > self.approve_after else "changes"
            (work / "REVIEW.md").write_text(f"veredito: {verdict}\n")
        return RunResult(self.name, role, ok=True, seconds=1, input_tokens=100, output_tokens=10, cost_usd=0.01,
                         plan_before={"five_hour": 10.0}, plan_after={"five_hour": 12.0})


def _pipeline(tmp_path, engine_list, gate_results):
    request = {"id": "abc1234567", "url": "https://www.exemplo.com/novel/x/", "domain": "exemplo.com",
               "novelUrl": "https://www.exemplo.com/novel/x/"}
    pipe = worker.Pipeline(request, worker.NullBrain(), engine_list, deploy=False, runner=lambda *a, **k: "")
    pipe.wt = tmp_path / "wt"
    pipe.work = pipe.wt / "backend" / "autoconnector" / "work"
    pipe.work.mkdir(parents=True)
    results = iter(gate_results)
    pipe.gate = lambda: next(results)
    return pipe


def test_source_id_from_domain():
    assert worker.source_id_for("www.exemplo-novels.com") == "exemplo-novels"
    assert worker.source_id_for("novels.site.com.br") == "novels-site-com"
    assert worker.num(1234567) == "1.234.567"


def test_build_runs_roles_in_order_and_stops_when_gate_and_review_pass(tmp_path, monkeypatch):
    monkeypatch.setattr(engines, "STATE_DIR", str(tmp_path / "state"))
    calls = []
    fake = FakeEngine("codex", calls=calls)
    pipe = _pipeline(tmp_path, [fake], [{"ok": True, "pytest": {"output": ""}, "files_outside_scope": []}])
    pipe.build()
    assert [r for _, r in calls] == ["site-analyst", "connector-builder", "test-writer", "qa-reviewer"]
    summary = pipe.cost_summary()
    assert summary["total"]["input_tokens"] == 400 and summary["plan_5h_points_used"] == {"codex": 8.0}


def test_fixer_loop_runs_until_review_approves(tmp_path):
    calls = []
    fake = FakeEngine("codex", approve_after=1, calls=calls)
    gates = [{"ok": False, "pytest": {"output": "1 failed"}, "files_outside_scope": []},
             {"ok": True, "pytest": {"output": ""}, "files_outside_scope": []}]
    pipe = _pipeline(tmp_path, [fake], gates)
    pipe.build()
    roles = [r for _, r in calls]
    assert roles[3:] == ["qa-reviewer", "connector-fixer", "qa-reviewer"]


def test_gives_up_after_two_fix_rounds(tmp_path):
    fake = FakeEngine("codex", approve_after=99)
    bad = {"ok": False, "pytest": {"output": "failed"}, "files_outside_scope": []}
    pipe = _pipeline(tmp_path, [fake], [bad, bad, bad])
    with pytest.raises(worker.StepFailed) as err:
        pipe.build()
    assert err.value.stage == "testing"


def test_switches_engine_when_plan_runs_out(tmp_path):
    calls = []
    codex = FakeEngine("codex", five_hour=5.0, limit_on={"connector-builder"}, calls=calls)
    claude = FakeEngine("claude", five_hour=40.0, calls=calls)
    pipe = _pipeline(tmp_path, [codex, claude], [{"ok": True, "pytest": {"output": ""}, "files_outside_scope": []}])
    pipe.build()
    assert ("claude", "connector-builder") in calls
    assert all(engine == "claude" for engine, role in calls if role in ("test-writer", "qa-reviewer"))


def test_unviable_site_fails_at_analysis(tmp_path):
    class Analyst(FakeEngine):
        def run(self, role, *a, **k):
            result = super().run(role, *a, **k)
            if role == "site-analyst":
                (Path(a[2]) / "backend/autoconnector/work/SITE_REPORT.md").write_text("# Resumo\nINVIAVEL: login obrigatório")
            return result
    pipe = _pipeline(tmp_path, [Analyst("codex")], [])
    with pytest.raises(worker.StepFailed) as err:
        pipe.build()
    assert err.value.stage == "analyzing"


def test_pick_engine_prefers_more_free_plan_and_avoids_full_week():
    a, b = FakeEngine("codex", five_hour=60), FakeEngine("claude", five_hour=10)
    assert pick_engine([a, b]).name == "claude"
    b.usage.weekly = 95
    assert pick_engine([a, b]).name == "codex"
    assert pick_engine([a, b], force="claude").name == "claude"
    assert pick_engine([a, b], exclude={"codex"}).name == "claude"


def test_claude_usage_parsed_from_rate_limit_event():
    event = {"type": "rate_limit_event", "rate_limit_info": {"status": "allowed", "unifiedWindows": {
        "five_hour": {"utilization": 0.42, "resetsAt": 1}, "seven_day": {"utilization": 0.13}}}}
    usage = engines.ClaudeCodeEngine._usage_from_event(event)
    assert (usage.five_hour, usage.weekly) == (42.0, 13.0)


def test_codex_usage_read_from_session_file(tmp_path, monkeypatch):
    session = tmp_path / "2026" / "rollout.jsonl"
    session.parent.mkdir(parents=True)
    session.write_text(json.dumps({"type": "event_msg", "payload": {"type": "token_count", "rate_limits": {
        "primary": {"used_percent": 7.0, "resets_at": 5}, "secondary": {"used_percent": 1.0}}}}) + "\n")
    monkeypatch.setattr(engines, "CODEX_SESSIONS", str(tmp_path))
    usage = engines.CodexEngine._usage_from_sessions()
    assert (usage.five_hour, usage.weekly) == (7.0, 1.0)


# ---------------------------------------------------------------- espera de plano, retomada e runtime venv

class RecordingBrain(worker.NullBrain):
    def __init__(self):
        super().__init__()
        self.updates = []

    def update(self, request_id, **fields):
        self.updates.append(fields)


class NoPlanEngine(FakeEngine):
    """Motor cujo plano acabou: a janela de 5 h volta em `back` (epoch)."""

    def __init__(self, name, back):
        super().__init__(name, five_hour=100.0)
        self.usage.resets_at = int(back)


def test_without_plan_request_goes_back_to_queue_with_return_time(tmp_path, monkeypatch):
    import time as _time
    monkeypatch.setenv("AUTOCONNECTOR_WORK", str(tmp_path / "ac"))
    back = _time.time() + 2 * 3600
    brain = RecordingBrain()
    request = {"id": "abc1234567", "url": "https://exemplo.com/", "domain": "exemplo.com", "novelUrl": None}
    pipe = worker.Pipeline(request, brain, [NoPlanEngine("codex", back), NoPlanEngine("claude", back + 600)],
                           deploy=False, runner=lambda *a, **k: "")
    pipe.wt = tmp_path / "wt"
    pipe.work = pipe.wt / "backend" / "autoconnector" / "work"
    pipe.existing_source = lambda: None
    pipe.run()
    final = brain.updates[-1]
    assert final["status"] == "queued" and final["stage"] == "waiting_plan"
    assert final["message"] == f"Aguardando plano, volta às {worker.back_label(back)}"
    assert abs(worker.datetime.fromisoformat(final["retry_at"]).timestamp() - back) < 1
    assert worker.interrupted_request() is None  # espera não é pedido interrompido


def test_plan_running_out_mid_role_pauses_instead_of_failing(tmp_path):
    codex = FakeEngine("codex", limit_on={"connector-builder"})
    pipe = _pipeline(tmp_path, [codex], [])
    with pytest.raises(worker.WaitPlan) as err:
        pipe.build()
    assert err.value.role == "connector-builder"
    assert json.loads((pipe.work / "PROGRESS.json").read_text())["done"] == ["site-analyst"]


def test_resume_continues_from_first_missing_step(tmp_path):
    calls = []
    fake = FakeEngine("codex", calls=calls)
    pipe = _pipeline(tmp_path, [fake], [{"ok": True, "pytest": {"output": ""}, "files_outside_scope": []}])
    (pipe.work / "SITE_REPORT.md").write_text("# Resumo\nWordPress.")
    conn = pipe.wt / "backend" / "src" / "oghma" / "scraper" / "connectors" / f"{pipe.module}.py"
    conn.parent.mkdir(parents=True)
    conn.write_text("# conector")
    pipe.build()
    assert [r for _, r in calls] == ["test-writer", "qa-reviewer"]


def test_resume_skips_finished_review_rounds(tmp_path):
    calls = []
    fake = FakeEngine("codex", approve_after=0, calls=calls)
    gates = [{"ok": True, "pytest": {"output": ""}, "files_outside_scope": []}]
    pipe = _pipeline(tmp_path, [fake], gates)
    (pipe.work / "PROGRESS.json").write_text(json.dumps({"done": [
        "site-analyst", "connector-builder", "test-writer", "qa-reviewer:0", "connector-fixer:1"]}))
    (pipe.work / "SITE_REPORT.md").write_text("ok")
    pipe.build()
    assert [r for _, r in calls] == ["qa-reviewer"]  # rodada 1: só a revisão


def test_gate_in_venv_mode_uses_venv_python_and_worktree_code(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTOCONNECTOR_RUNTIME", "venv")
    monkeypatch.setenv("OGHMA_VENV", "/opt/oghma/venv")
    env_file = tmp_path / ".env"
    env_file.write_text("OGHMA_DATABASE_URL=postgresql+asyncpg://x\n")
    monkeypatch.setenv("OGHMA_ENV_FILE", str(env_file))
    request = {"id": "abc1234567", "url": "https://exemplo.com/novel/x", "domain": "exemplo.com",
               "novelUrl": "https://exemplo.com/novel/x"}
    pipe = worker.Pipeline(request, worker.NullBrain(), [FakeEngine("codex")], deploy=False, runner=lambda *a, **k: "")
    pipe.wt = tmp_path / "wt"
    pipe.work = pipe.wt / "backend" / "autoconnector" / "work"
    pipe.work.mkdir(parents=True)
    seen = []

    def fake_proc(cmd, cwd=None, env=None, timeout=1800):
        seen.append((cmd, cwd, env))
        if "pytest" in cmd:
            return 0, "....\n204 passed in 3.0s"
        return 0, 'aviso\n{"ok": true, "checks": [], "novel": {"title": "X"}}'

    pipe.proc = fake_proc
    gate = pipe.gate()
    assert gate["ok"] and gate["probe"]["novel"]["title"] == "X"
    pytest_cmd, cwd, env = seen[0]
    assert pytest_cmd[0] == "/opt/oghma/venv/bin/python" and cwd == pipe.wt / "backend"
    assert env["PYTHONPATH"].startswith(str(pipe.wt / "backend" / "src"))
    assert env["OGHMA_DATABASE_URL"] == "postgresql+asyncpg://x"
    probe_cmd = seen[1][0]
    assert probe_cmd[1:4] == ["-m", "oghma.cli", "probe-connector"] and "--novel-url" in probe_cmd


def test_venv_crawl_and_publish_commands(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTOCONNECTOR_RUNTIME", "venv")
    monkeypatch.setenv("OGHMA_VENV", "/opt/oghma/venv")
    monkeypatch.setenv("OGHMA_LOCK_DIR", "/var/lib/oghma/locks")
    request = {"id": "abc1234567", "url": "https://exemplo.com/novel/x", "domain": "exemplo.com",
               "novelUrl": "https://exemplo.com/novel/x"}
    pipe = worker.Pipeline(request, worker.NullBrain(), [FakeEngine("codex")], deploy=False, runner=lambda *a, **k: "")
    cmds = []
    pipe.proc = lambda cmd, cwd=None, env=None, timeout=1800: (cmds.append(cmd) or (0, ""))
    pipe.crawl_requested_and_publish()
    assert cmds[0][:3] == ["flock", "/var/lib/oghma/locks/crawl-exemplo.lock", "/opt/oghma/venv/bin/oghma"]
    assert cmds[0][3:] == ["crawl", "--source", "exemplo", "--novel-url", "https://exemplo.com/novel/x"]
    assert cmds[1][2:] == ["/opt/oghma/venv/bin/python", "-m", "oghma.publish", "--source", "exemplo"]


def test_interrupted_request_is_remembered_until_it_ends(tmp_path, monkeypatch):
    monkeypatch.setenv("AUTOCONNECTOR_WORK", str(tmp_path))
    req = {"id": "abc1234567", "domain": "exemplo.com"}
    worker.save_current(req)
    assert worker.interrupted_request()["id"] == "abc1234567"
    worker.clear_current({"id": "outro"})
    assert worker.interrupted_request() is not None
    worker.clear_current(req)
    assert worker.interrupted_request() is None


def test_back_label_today_and_other_day():
    now = worker.datetime(2026, 10, 3, 12, 0, tzinfo=worker.BRT).timestamp()
    assert worker.back_label(now + 2.5 * 3600, now) == "14:30"
    assert worker.back_label(now + 24 * 3600, now) == "04/10 12:00"


def test_plan_exhaustion_and_return_time():
    import time as _time
    now = _time.time()
    full = PlanUsage(five_hour=100.0, resets_at=int(now + 600))
    assert full.exhausted(now) and full.available_at(now) == int(now + 600)
    assert not PlanUsage(five_hour=100.0, resets_at=int(now - 5)).exhausted(now)  # janela já reabriu
    week = PlanUsage(five_hour=10.0, weekly=100.0, weekly_resets_at=int(now + 9000))
    assert week.exhausted(now) and week.available_at(now) == int(now + 9000)
