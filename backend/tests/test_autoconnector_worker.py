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
