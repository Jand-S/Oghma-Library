"""Motores de IA do autoconnector: Claude Code e Codex em modo sem interface.

Cada motor roda um papel (prompt do subagente + tarefa) dentro do worktree e devolve
um `RunResult` com tokens, custo e o uso do plano antes e depois. O uso do plano vem
do proprio CLI: o Claude Code emite `rate_limit_event` no stream JSON; o Codex grava
`rate_limits` no arquivo da sessao em ~/.codex/sessions.
"""
from __future__ import annotations

import glob
import json
import os
import subprocess
import time
from dataclasses import asdict, dataclass, field

STATE_DIR = os.path.expanduser(os.environ.get("AUTOCONNECTOR_STATE", "~/.local/state/oghma-autoconnector"))
PLAN_CACHE_SECONDS = 20 * 60
WEEKLY_CEILING = 90.0  # acima disso o motor so e usado se nao houver outro


class LimitHit(RuntimeError):
    """O plano do motor acabou (janela de 5 h ou semanal)."""


@dataclass
class PlanUsage:
    five_hour: float | None = None  # porcentagem usada da janela de 5 h
    weekly: float | None = None  # porcentagem usada da janela semanal
    resets_at: int | None = None
    checked_at: float = 0.0
    weekly_resets_at: int | None = None

    def exhausted(self, now: float | None = None) -> bool:
        """Plano esgotado (janela de 5 h ou semanal em 100%) e a janela ainda nao reabriu."""
        now = time.time() if now is None else now
        if self.weekly is not None and self.weekly >= 100 and (self.weekly_resets_at or now + 1) > now:
            return True
        return self.five_hour is not None and self.five_hour >= 100 and (self.resets_at or now + 1) > now

    def available_at(self, now: float | None = None) -> float:
        """Quando o motor volta a ter plano (epoch). Sem dado, 1 h a partir de agora."""
        now = time.time() if now is None else now
        if self.weekly is not None and self.weekly >= 100 and self.weekly_resets_at:
            return float(self.weekly_resets_at)
        return float(self.resets_at) if self.resets_at and self.resets_at > now else now + 3600

    def score(self) -> float:
        """Menor e melhor. Sem dado, fica no meio para nao ser sempre escolhido nem evitado."""
        five = 50.0 if self.five_hour is None else self.five_hour
        week = 0.0 if self.weekly is None else self.weekly
        return five + (1000.0 if week >= WEEKLY_CEILING else 0.0)


@dataclass
class RunResult:
    engine: str
    role: str
    ok: bool
    seconds: float = 0.0
    input_tokens: int = 0
    cached_input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float | None = None
    plan_before: dict = field(default_factory=dict)
    plan_after: dict = field(default_factory=dict)
    error: str = ""
    log_tail: str = ""

    def as_dict(self) -> dict:
        return asdict(self)


def _state_path(name: str) -> str:
    os.makedirs(STATE_DIR, exist_ok=True)
    return os.path.join(STATE_DIR, f"plan-{name}.json")


class Engine:
    name = "base"

    def available(self) -> bool:
        raise NotImplementedError

    def plan(self, fresh: bool = False) -> PlanUsage:
        path = _state_path(self.name)
        if not fresh and os.path.exists(path):
            try:
                data = json.load(open(path))
                if time.time() - data.get("checked_at", 0) < PLAN_CACHE_SECONDS:
                    return PlanUsage(**data)
            except (OSError, ValueError, TypeError):
                pass
        usage = self._probe_plan()
        usage.checked_at = time.time()
        json.dump(asdict(usage), open(path, "w"))
        return usage

    def _save_plan(self, usage: PlanUsage) -> None:
        if usage.five_hour is None and usage.weekly is None:
            return
        usage.checked_at = time.time()
        json.dump(asdict(usage), open(_state_path(self.name), "w"))

    def _probe_plan(self) -> PlanUsage:
        raise NotImplementedError

    def run(self, role: str, system_prompt: str, task: str, cwd: str, *, timeout: int, network: bool) -> RunResult:
        raise NotImplementedError


def _run_lines(cmd: list[str], cwd: str, timeout: int, stdin: str | None = None) -> tuple[int, list[str], str]:
    proc = subprocess.run(cmd, cwd=cwd, input=stdin, capture_output=True, text=True, timeout=timeout)
    return proc.returncode, proc.stdout.splitlines(), proc.stderr


# ------------------------------------------------------------------ Claude Code

CLAUDE_BIN = os.environ.get("CLAUDE_BIN", os.path.expanduser("~/.local/bin/claude"))


class ClaudeCodeEngine(Engine):
    name = "claude"

    def available(self) -> bool:
        if not os.path.exists(CLAUDE_BIN):
            return False
        try:
            out = subprocess.run([CLAUDE_BIN, "auth", "status"], capture_output=True, text=True, timeout=30).stdout
            return '"loggedIn": true' in out
        except (OSError, subprocess.TimeoutExpired):
            return False

    @staticmethod
    def _usage_from_event(event: dict) -> PlanUsage | None:
        info = event.get("rate_limit_info") or {}
        windows = info.get("unifiedWindows") or {}
        if not windows:
            return None
        five = windows.get("five_hour", {}).get("utilization")
        week = windows.get("seven_day", {}).get("utilization")
        return PlanUsage(
            five_hour=None if five is None else round(float(five) * 100, 1),
            weekly=None if week is None else round(float(week) * 100, 1),
            resets_at=windows.get("five_hour", {}).get("resetsAt"),
            weekly_resets_at=windows.get("seven_day", {}).get("resetsAt"),
        )

    def _probe_plan(self) -> PlanUsage:
        try:
            _, lines, _ = _run_lines([CLAUDE_BIN, "-p", "ok", "--output-format", "stream-json", "--verbose",
                                      "--max-turns", "1"], cwd="/tmp", timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            return PlanUsage()
        for line in lines:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "rate_limit_event":
                usage = self._usage_from_event(event)
                if usage:
                    return usage
        return PlanUsage()

    def run(self, role, system_prompt, task, cwd, *, timeout, network):
        before = self.plan()
        tools = ROLE_TOOLS_CLAUDE.get(role, "Read Glob Grep")
        cmd = [CLAUDE_BIN, "-p", task, "--output-format", "stream-json", "--verbose",
               "--permission-mode", "acceptEdits", "--allowedTools", tools,
               "--append-system-prompt", system_prompt, "--max-turns", "120"]
        started = time.monotonic()
        result = RunResult(self.name, role, ok=False, plan_before=asdict(before))
        try:
            code, lines, stderr = _run_lines(cmd, cwd=cwd, timeout=timeout)
        except subprocess.TimeoutExpired:
            result.error = f"tempo esgotado ({timeout} s)"
            return result
        result.seconds = round(time.monotonic() - started, 1)
        limit = False
        after = None
        for line in lines:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            kind = event.get("type")
            if kind == "rate_limit_event":
                after = self._usage_from_event(event) or after
                if (event.get("rate_limit_info") or {}).get("status") == "rejected":
                    limit = True
            elif kind == "assistant" and event.get("error") == "rate_limit":
                limit = True
            elif kind == "result":
                usage = event.get("usage") or {}
                result.input_tokens = int(usage.get("input_tokens", 0)) + int(usage.get("cache_creation_input_tokens", 0))
                result.cached_input_tokens = int(usage.get("cache_read_input_tokens", 0))
                result.output_tokens = int(usage.get("output_tokens", 0))
                result.cost_usd = event.get("total_cost_usd")
                result.ok = not event.get("is_error") and code == 0
                if event.get("is_error"):
                    result.error = str(event.get("result") or event.get("subtype") or "erro")[:500]
        if after:
            self._save_plan(after)
            result.plan_after = asdict(after)
        result.log_tail = "\n".join(lines[-20:])[-4000:]
        if limit and not result.ok:
            raise LimitHit(f"claude: limite do plano ({result.error})")
        if not result.ok and not result.error:
            result.error = (stderr or "sem resultado")[-500:]
        return result


# Ferramentas por papel no Claude Code (o Codex usa o sandbox do proprio CLI).
ROLE_TOOLS_CLAUDE = {
    "site-analyst": "Read Write Bash(curl:*) Bash(python3:*) Bash(mkdir:*) Bash(ls:*) Bash(sleep:*)",
    "connector-builder": "Read Write Edit Glob Grep",
    "test-writer": "Read Write Glob",
    "qa-reviewer": "Read Glob Grep Write",
    "connector-fixer": "Read Write Edit Glob Grep Bash(curl:*) Bash(python3:*) Bash(sleep:*)",
    "connector-maintainer": "Read Write Edit Glob Grep Bash(curl:*) Bash(python3:*) Bash(sleep:*)",
}


# ------------------------------------------------------------------ Codex

CODEX_BIN = os.environ.get("CODEX_BIN", "codex")
CODEX_SESSIONS = os.path.expanduser("~/.codex/sessions")


class CodexEngine(Engine):
    name = "codex"

    def available(self) -> bool:
        try:
            out = subprocess.run([CODEX_BIN, "login", "status"], capture_output=True, text=True, timeout=30)
            return "Logged in" in (out.stdout + out.stderr)
        except (OSError, subprocess.TimeoutExpired):
            return False

    @staticmethod
    def _usage_from_sessions(since: float = 0.0) -> PlanUsage | None:
        files = sorted(glob.glob(os.path.join(CODEX_SESSIONS, "**", "*.jsonl"), recursive=True), key=os.path.getmtime)
        for path in reversed(files[-5:]):
            if os.path.getmtime(path) < since:
                break
            last = None
            for line in open(path, encoding="utf-8", errors="ignore"):
                if '"rate_limits"' in line:
                    last = line
            if not last:
                continue
            try:
                event = json.loads(last)
            except ValueError:
                continue
            limits = _find_key(event, "rate_limits") or {}
            primary, secondary = limits.get("primary") or {}, limits.get("secondary") or {}
            return PlanUsage(five_hour=primary.get("used_percent"), weekly=secondary.get("used_percent"),
                             resets_at=primary.get("resets_at"), weekly_resets_at=secondary.get("resets_at"))
        return None

    def _probe_plan(self) -> PlanUsage:
        recent = self._usage_from_sessions(since=time.time() - PLAN_CACHE_SECONDS)
        if recent:
            return recent
        try:
            _run_lines([CODEX_BIN, "exec", "--json", "--skip-git-repo-check", "Responda apenas: ok"],
                       cwd="/tmp", timeout=180, stdin="")
        except (OSError, subprocess.TimeoutExpired):
            return PlanUsage()
        return self._usage_from_sessions() or PlanUsage()

    def run(self, role, system_prompt, task, cwd, *, timeout, network):
        before = self.plan()
        prompt = f"{system_prompt}\n\n---\n\n{task}"
        # O prompt vai pela entrada padrao ("-"): texto comecando com "-" nao vira opcao do CLI.
        cmd = [CODEX_BIN, "exec", "--json", "--skip-git-repo-check", "-C", cwd,
               "--sandbox", "workspace-write", "-c", f"sandbox_workspace_write.network_access={'true' if network else 'false'}",
               "-"]
        started = time.time()
        result = RunResult(self.name, role, ok=False, plan_before=asdict(before))
        try:
            code, lines, stderr = _run_lines(cmd, cwd=cwd, timeout=timeout, stdin=prompt)
        except subprocess.TimeoutExpired:
            result.error = f"tempo esgotado ({timeout} s)"
            return result
        result.seconds = round(time.time() - started, 1)
        errors = []
        for line in lines:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            kind = event.get("type", "")
            if kind == "turn.completed":
                usage = event.get("usage") or {}
                result.input_tokens += int(usage.get("input_tokens", 0))
                result.cached_input_tokens += int(usage.get("cached_input_tokens", 0))
                result.output_tokens += int(usage.get("output_tokens", 0)) + int(usage.get("reasoning_output_tokens", 0))
            elif kind in ("error", "turn.failed"):
                errors.append(json.dumps(event)[:400])
        after = self._usage_from_sessions(since=started - 5)
        if after:
            self._save_plan(after)
            result.plan_after = asdict(after)
        result.ok = code == 0 and not errors
        result.error = " | ".join(errors)[:800] or ("" if code == 0 else stderr[-500:])
        result.log_tail = "\n".join(lines[-20:])[-4000:]
        joined = result.error.lower()
        if not result.ok and ("usage limit" in joined or "rate limit" in joined or "429" in joined):
            raise LimitHit(f"codex: limite do plano ({result.error[:200]})")
        return result


def _find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for value in obj.values():
            found = _find_key(value, key)
            if found is not None:
                return found
    elif isinstance(obj, list):
        for value in obj:
            found = _find_key(value, key)
            if found is not None:
                return found
    return None


# ------------------------------------------------------------------ escolha

def plan_back_at(engines: list[Engine], now: float | None = None) -> float:
    """O mais cedo em que algum motor volta a ter plano (epoch)."""
    now = time.time() if now is None else now
    return min((e.plan().available_at(now) for e in engines), default=now + 3600)

def pick_engine(engines: list[Engine], exclude: set[str] = frozenset(), force: str | None = None) -> Engine:
    """O motor com mais plano livre (menor uso da janela de 5 h, evitando semanal quase cheio)."""
    usable = [e for e in engines if e.name not in exclude and not e.plan().exhausted()]
    if force:
        usable = [e for e in usable if e.name == force] or usable
    if not usable:
        raise LimitHit("nenhum motor com plano disponivel")
    return min(usable, key=lambda e: e.plan().score())
