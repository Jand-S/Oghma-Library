#!/usr/bin/env python3
"""Worker do autoconnector: pedido de fonte aprovado no brain -> conector no ar.

Roda no servidor local como o usuario `codex` (dono do repo, grupo docker), so com a
biblioteca padrao. A sequencia dos subagentes, o portao e o deploy ficam aqui, em
codigo fixo; os agentes de IA so escrevem codigo no worktree.

  worker.py loop            # busca pedidos aprovados no brain a cada 2 min
  worker.py once            # processa no maximo um pedido
  worker.py run --url URL [--engine codex|claude] [--no-deploy]   # ensaio sem o brain

Configuracao (env ou ~/.config/oghma-autoconnector.env): BRAIN_URL, BRAIN_TOKEN,
OGHMA_REPO, AUTOCONNECTOR_WORK, OGHMA_COMPOSE_DIR, AUTOCONNECTOR_ENGINE (forca um motor).

Runtime (AUTOCONNECTOR_RUNTIME):
  docker (padrao, xeonserver): portao e deploy com a imagem oghma-crawler e docker compose.
  venv (VPS): OGHMA_VENV (ex.: /opt/oghma/venv), OGHMA_ENV_FILE (ex.: /opt/oghma/.env),
    OGHMA_STORAGE_ROOT, OGHMA_LOCK_DIR, AUTOCONNECTOR_RESTART_CMD
    (padrao "sudo -n systemctl restart oghma-rodizio").

Sem plano em nenhum motor, o pedido volta para a fila do brain com stage=waiting_plan e
retry_at; quando o plano volta, o pedido e retomado do subagente onde parou
(work/PROGRESS.json e as entregas no worktree). Um pedido interrompido por reinicio
(AUTOCONNECTOR_WORK/current.json) e retomado quando o worker sobe de novo.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engines import ClaudeCodeEngine, CodexEngine, LimitHit, RunResult, pick_engine, plan_back_at  # noqa: E402

HERE = Path(__file__).resolve().parent
ROLE_TIMEOUT = int(os.environ.get("AUTOCONNECTOR_ROLE_TIMEOUT", 45 * 60))
FIX_ROUNDS = 2
POLL_SECONDS = 120
BUILD_ROLES = ["site-analyst", "connector-builder", "test-writer"]
NETWORK_ROLES = {"site-analyst", "connector-fixer", "connector-maintainer"}
BRT = timezone(timedelta(hours=-3))  # horario de Brasilia (sem horario de verao)


def load_env_file() -> None:
    path = Path(os.path.expanduser("~/.config/oghma-autoconnector.env"))
    if path.exists():
        for line in path.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                os.environ.setdefault(key.strip(), value.strip())


def num(value: float) -> str:
    """Inteiro com ponto de milhar (12.345)."""
    return f"{int(value):,}".replace(",", ".")


def cfg(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def read_env_file(path: str) -> dict:
    """KEY=VALUE de um .env (sem expansao), para os comandos do venv."""
    out: dict = {}
    p = Path(path)
    if p.is_file():
        for line in p.read_text().splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                out[key.strip()] = value.strip().strip('"').strip("'")
    return out


def back_label(epoch: float, now: float | None = None) -> str:
    """Hora em que o plano volta, em Brasilia: "14:30" hoje, "04/10 09:00" em outro dia."""
    when = datetime.fromtimestamp(epoch, BRT)
    today = datetime.fromtimestamp(time.time() if now is None else now, BRT).date()
    return when.strftime("%H:%M") if when.date() == today else when.strftime("%d/%m %H:%M")


def source_id_for(domain: str) -> str:
    base = domain.split(":")[0].removeprefix("www.")
    parts = base.split(".")
    core = parts[0] if len(parts) <= 2 else "-".join(parts[:-1])
    return re.sub(r"[^a-z0-9]+", "-", core.lower()).strip("-")[:40] or "fonte"


# ------------------------------------------------------------------ brain

class Brain:
    def __init__(self, url: str, token: str):
        self.url, self.token = url.rstrip("/"), token

    def _call(self, method: str, route: str, body: dict | None = None) -> dict:
        data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
        req = urllib.request.Request(self.url + route, data=data, method=method)
        req.add_header("Authorization", f"Bearer {self.token}")
        if data is not None:
            req.add_header("Content-Type", "application/json")
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode() or "{}")

    def next_request(self) -> dict | None:
        return self._call("GET", "/api/oghma/source-requests/next").get("request")

    def update(self, request_id: str, **fields) -> None:
        if not request_id:
            print("[brain]", json.dumps(fields, ensure_ascii=False)[:400], flush=True)
            return
        try:
            self._call("POST", f"/api/oghma/source-requests/{request_id}/status", fields)
        except (urllib.error.URLError, OSError) as exc:  # o pedido segue mesmo sem o brain
            print(f"[brain] falha ao reportar: {exc}", flush=True)

    def notify(self, **fields) -> None:
        try:
            self._call("POST", "/api/notify", {"app": "oghma", **fields})
        except (urllib.error.URLError, OSError) as exc:
            print(f"[brain] falha ao avisar: {exc}", flush=True)


class NullBrain(Brain):
    def __init__(self):
        super().__init__("", "")

    def update(self, request_id, **fields):
        line = {k: v for k, v in fields.items() if k not in ("log", "cost")}
        print("[status]", json.dumps(line, ensure_ascii=False), flush=True)
        if fields.get("log") and (fields.get("level") == "error" or "falhou" in str(fields.get("title", ""))):
            print("[log]", str(fields["log"])[-3000:], flush=True)

    def notify(self, **fields):
        print("[aviso]", fields.get("level"), fields.get("title"), flush=True)


class _LocalRunBrain(NullBrain):
    """Ensaio sem pedido no brain: cada etapa vira um aviso numa thread propria."""

    def __init__(self, brain: Brain, request: dict, engine: str | None = None):
        super().__init__()
        self.brain, self.thread = brain, f"oghma-ensaio-{request['id']}"
        who = f" ({engine})" if engine else ""
        self.subject = f"Ensaio do autoconnector{who}: {request['domain']} → {request.get('sourceId') or source_id_for(request['domain'])}"

    def update(self, request_id, **fields):
        super().update(request_id, **fields)
        if fields.get("title"):
            self.brain.notify(level=fields.get("level", "info"), thread=self.thread, title=fields["title"],
                              subject=self.subject, body=fields.get("body") or fields.get("log", "")[:1500])


# ------------------------------------------------------------------ pipeline

class WaitPlan(RuntimeError):
    """Nenhum motor com plano: o pedido espera na fila ate `at` (epoch)."""

    def __init__(self, at: float, role: str):
        super().__init__(f"sem plano em nenhum motor ({role})")
        self.at, self.role = at, role


class StepFailed(RuntimeError):
    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage


class Pipeline:
    def __init__(self, request: dict, brain: Brain, engines, *, force_engine: str | None = None,
                 deploy: bool = True, runner=None, rebuild: bool = False):
        self.req = request
        self.brain = brain
        self.engines = engines
        self.force = force_engine
        self.deploy_enabled = deploy
        self.repo = Path(cfg("OGHMA_REPO", "/home/codex/oghma-library"))
        self.compose_dir = Path(cfg("OGHMA_COMPOSE_DIR", "/home/codex/oghma"))
        self.domain = request["domain"]
        self.source_id = request.get("sourceId") or source_id_for(self.domain)
        self.module = self.source_id.replace("-", "_")
        self.wt = Path(cfg("AUTOCONNECTOR_WORK", "/home/codex/oghma-autoconnector")) / f"{request['id']}-{self.source_id}"
        self.work = self.wt / "backend" / "autoconnector" / "work"
        self.costs: list[dict] = []
        self.sh = runner or self._sh
        self.limited: set[str] = set()
        self.rebuild = rebuild  # ensaio: recria o conector mesmo se o dominio ja for uma fonte
        self.runtime = cfg("AUTOCONNECTOR_RUNTIME", "docker")
        self.venv = Path(cfg("OGHMA_VENV", "/opt/oghma/venv"))
        self.lock_dir = cfg("OGHMA_LOCK_DIR", "/srv/oghma/locks")
        self.progress: list[str] = []

    # -- utilitarios
    def _sh(self, cmd: list[str], cwd: Path | None = None, timeout: int = 1800, check: bool = True) -> str:
        proc = subprocess.run(cmd, cwd=str(cwd) if cwd else None, capture_output=True, text=True, timeout=timeout)
        if check and proc.returncode != 0:
            raise RuntimeError(f"{' '.join(cmd[:4])}... saiu com {proc.returncode}: {(proc.stderr or proc.stdout)[-1500:]}")
        return proc.stdout

    def proc(self, cmd: list[str], cwd: Path | None = None, env: dict | None = None, timeout: int = 1800) -> tuple[int, str]:
        """Comando do portao (retorno + saida juntas). Isolado para os testes trocarem."""
        p = subprocess.run(cmd, cwd=str(cwd) if cwd else None, env=env, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr or "")

    def venv_env(self, src: Path | None = None) -> dict:
        """Ambiente dos comandos no venv: .env do Oghma, storage e, no portao, o codigo do worktree."""
        env = {**os.environ, **read_env_file(cfg("OGHMA_ENV_FILE", "/opt/oghma/.env"))}
        if cfg("OGHMA_STORAGE_ROOT"):
            env["OGHMA_STORAGE_ROOT"] = cfg("OGHMA_STORAGE_ROOT")
        if src is not None:
            env["PYTHONPATH"] = str(src) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
        return env

    def oghma_cmd(self, *args: str) -> tuple[list[str], Path | None]:
        """`oghma <args>` no runtime atual: container do compose ou CLI do venv."""
        if self.runtime == "venv":
            return [str(self.venv / "bin" / "oghma"), *args], None
        return ["docker", "compose", "run", "--rm", "--no-deps", "crawler", "oghma", *args], self.compose_dir

    def publish_cmd(self) -> tuple[list[str], Path | None]:
        if self.runtime == "venv":
            return [str(self.venv / "bin" / "python"), "-m", "oghma.publish", "--source", self.source_id], None
        return ["docker", "compose", "run", "--rm", "--no-deps", "crawler", "python", "-m", "oghma.publish",
                "--source", self.source_id], self.compose_dir

    def run_oghma(self, *args: str, lock: str | None = None, timeout: int = 1800, publish: bool = False) -> str:
        cmd, cwd = self.publish_cmd() if publish else self.oghma_cmd(*args)
        if lock:
            cmd = ["flock", f"{self.lock_dir}/{lock}", *cmd]
        if self.runtime == "venv":
            code, out = self.proc(cmd, cwd=cwd, env=self.venv_env(), timeout=timeout)
            if code != 0:
                raise RuntimeError(f"{' '.join(cmd[:4])}... saiu com {code}: {out[-1500:]}")
            return out
        return self.sh(cmd, cwd=cwd, timeout=timeout)

    # -- progresso (retomada depois de falta de plano ou reinicio)
    def load_progress(self) -> None:
        path = self.work / "PROGRESS.json"
        if path.exists():
            try:
                self.progress = list(json.loads(path.read_text()).get("done", []))
            except ValueError:
                self.progress = []
        # Entregas que ja estao no worktree contam como feitas, mesmo sem PROGRESS.json.
        delivered = {
            "site-analyst": self.work / "SITE_REPORT.md",
            "connector-builder": self.wt / "backend" / "src" / "oghma" / "scraper" / "connectors" / f"{self.module}.py",
            "test-writer": self.wt / "backend" / "tests" / f"test_{self.module}.py",
        }
        for step, path in delivered.items():
            if path.exists() and step not in self.progress:
                self.progress.append(step)

    def mark_done(self, step: str) -> None:
        if step not in self.progress:
            self.progress.append(step)
        self.work.mkdir(parents=True, exist_ok=True)
        (self.work / "PROGRESS.json").write_text(json.dumps({"done": self.progress, "updated_at": time.time()}, indent=2))

    def done(self, step: str) -> bool:
        return step in self.progress

    def report(self, stage: str | None = None, title: str | None = None, **extra) -> None:
        fields = {"cost": self.cost_summary(), **extra}
        if stage:
            fields["stage"] = stage
        if title:
            fields["title"] = title
        self.brain.update(self.req.get("id", ""), **fields)

    def cost_summary(self) -> dict:
        total = {"input_tokens": 0, "cached_input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "seconds": 0.0}
        plan_used: dict[str, float] = {}
        for c in self.costs:
            for key in ("input_tokens", "cached_input_tokens", "output_tokens", "seconds"):
                total[key] += c.get(key) or 0
            total["cost_usd"] += c.get("cost_usd") or 0.0
            before, after = c.get("plan_before") or {}, c.get("plan_after") or {}
            if before.get("five_hour") is not None and after.get("five_hour") is not None:
                plan_used[c["engine"]] = round(plan_used.get(c["engine"], 0) + max(0.0, after["five_hour"] - before["five_hour"]), 1)
        total["cost_usd"] = round(total["cost_usd"], 4)
        return {"total": total, "plan_5h_points_used": plan_used, "runs": self.costs}

    # -- etapas
    def existing_source(self) -> str | None:
        cli = (self.repo / "backend" / "src" / "oghma" / "cli.py").read_text(encoding="utf-8")
        for match in re.finditer(r'id="([^"]+)",\s*name="[^"]*",\s*base_url="([^"]+)"', cli):
            host = (urlsplit(match.group(2)).hostname or "").removeprefix("www.")
            if host == self.domain:
                return match.group(1)
        return None

    def prepare_worktree(self) -> None:
        branch = f"autoconnector/{self.req['id']}"
        if not self.wt.exists():
            self.wt.parent.mkdir(parents=True, exist_ok=True)
            self.sh(["git", "-C", str(self.repo), "worktree", "add", "-B", branch, str(self.wt), "HEAD"])
        self.work.mkdir(parents=True, exist_ok=True)
        (self.wt / "backend" / "tests" / "fixtures" / self.source_id).mkdir(parents=True, exist_ok=True)
        (self.work / "REQUEST.json").write_text(json.dumps({
            "request_id": self.req.get("id"), "site_url": self.req.get("url"), "novel_url": self.req.get("novelUrl"),
            "domain": self.domain, "source_id": self.source_id, "module": self.module,
            "note": self.req.get("note") or "",
        }, ensure_ascii=False, indent=2), encoding="utf-8")

    def role_prompt(self, role: str) -> str:
        """Corpo do prompt do papel, sem o cabecalho YAML (que so serve a definicao de subagente)."""
        text = (HERE / "agents" / f"{role}.md").read_text(encoding="utf-8")
        return re.sub(r"\A---\n.*?\n---\n", "", text, count=1, flags=re.S).strip()

    def run_role(self, role: str, task: str) -> RunResult:
        """Roda um papel no motor com mais plano livre; se o plano acabar no meio, tenta o outro.
        Sem plano em nenhum, levanta WaitPlan (o pedido volta para a fila)."""
        for _ in range(len(self.engines) + 1):
            try:
                engine = pick_engine(self.engines, exclude=self.limited, force=self.force)
            except LimitHit:
                raise WaitPlan(plan_back_at(self.engines), role)
            self.report(title=f"{role}: começou ({engine.name})")
            try:
                result = engine.run(role, self.role_prompt(role), task, str(self.wt),
                                    timeout=ROLE_TIMEOUT, network=role in NETWORK_ROLES)
            except LimitHit as exc:
                self.limited.add(engine.name)
                self.report(title=f"{role}: {engine.name} sem plano, trocando de motor", log=str(exc))
                continue
            self.costs.append(result.as_dict())
            (self.work / "COSTS.json").write_text(json.dumps(self.cost_summary(), indent=2), encoding="utf-8")
            tokens = result.input_tokens + result.output_tokens
            cost = f", US$ {result.cost_usd:.2f}" if result.cost_usd else ""
            self.report(title=f"{role}: {'ok' if result.ok else 'falhou'} ({engine.name}, {int(result.seconds)} s, {num(tokens)} tokens{cost})",
                        log=f"{role} {engine.name}: {result.error or 'ok'}\n{result.log_tail[-1500:]}")
            if not result.ok:
                raise StepFailed(role, result.error or f"{role} terminou com erro")
            return result
        raise WaitPlan(plan_back_at(self.engines), role)

    def task_text(self, role: str, round_no: int = 0) -> str:
        base = (f"Fonte: {self.domain} (source_id `{self.source_id}`, modulo `{self.module}`). "
                f"Pedido em `backend/autoconnector/work/REQUEST.json`. Siga o seu papel ({role}) e o contexto em "
                f"`backend/autoconnector/CONTEXT.md`. Trabalhe só dentro deste repositório.")
        if role == "connector-fixer":
            base += f" Esta é a rodada {round_no} de correção."
        return base

    def gate(self) -> dict:
        """Portao deterministico: pytest + teste ao vivo + diff restrito. Grava GATE.json e DIFF.patch."""
        backend = self.wt / "backend"
        self.sh(["git", "add", "-A"], cwd=self.wt)
        diff = self.sh(["git", "diff", "--cached", "HEAD"], cwd=self.wt)
        (self.work / "DIFF.patch").write_text(diff, encoding="utf-8")
        changed = [l for l in self.sh(["git", "diff", "--cached", "--name-only", "HEAD"], cwd=self.wt).splitlines() if l]
        allowed = (f"backend/src/oghma/scraper/connectors/{self.module}.py",
                   "backend/src/oghma/scraper/connectors/__init__.py",
                   "backend/src/oghma/cli.py",
                   f"backend/tests/test_{self.module}.py",
                   f"backend/tests/fixtures/{self.source_id}/",
                   "backend/autoconnector/work/")
        outside = [p for p in changed if not p.startswith(allowed)]
        novel_args = ["--novel-url", self.req["novelUrl"]] if self.req.get("novelUrl") else []
        if self.runtime == "venv":
            # Codigo do worktree na frente do pacote instalado: testa o conector novo sem instalar.
            env = self.venv_env(src=backend / "src")
            python = str(self.venv / "bin" / "python")
            _, pytest_out = self.proc([python, "-m", "pytest", "-q", "-p", "no:cacheprovider", "tests"],
                                      cwd=backend, env=env)
            _, probe_out = self.proc([python, "-m", "oghma.cli", "probe-connector", "--source", self.source_id, *novel_args],
                                     cwd=backend, env=env)
        else:
            _, pytest_out = self.proc(
                ["docker", "run", "--rm", "-v", f"{backend}:/w", "-w", "/w", "--entrypoint", "sh", "oghma-crawler:latest", "-c",
                 "pip install -q --root-user-action=ignore pytest pytest-asyncio >/dev/null 2>&1; "
                 "pip install -q --root-user-action=ignore --no-deps -e . >/dev/null 2>&1; "
                 "python -m pytest -q -p no:cacheprovider tests 2>&1 | tail -40"])
            _, probe_out = self.proc(
                ["docker", "run", "--rm", "--network", "oghma_default", "--env-file", str(self.compose_dir / ".env"),
                 "-v", f"{backend / 'src' / 'oghma'}:/usr/local/lib/python3.11/site-packages/oghma",
                 "--entrypoint", "oghma", "oghma-crawler:latest", "probe-connector", "--source", self.source_id, *novel_args])
        pytest_out = pytest_out[-12000:]
        pytest_ok = bool(re.search(r"\b\d+ passed\b", pytest_out)) and not re.search(r"\b\d+ (failed|error)", pytest_out)
        try:
            probe_report = json.loads(probe_out[probe_out.index("{"):probe_out.rindex("}") + 1])
        except ValueError:
            probe_report = {"ok": False, "error": probe_out[-3000:]}
        result = {"ok": pytest_ok and bool(probe_report.get("ok")) and not outside,
                  "pytest": {"ok": pytest_ok, "output": pytest_out[-6000:]},
                  "probe": probe_report, "files_outside_scope": outside}
        (self.work / "GATE.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        return result

    def review_verdict(self) -> str:
        path = self.work / "REVIEW.md"
        text = path.read_text(encoding="utf-8").lower() if path.exists() else ""
        return "approve" if re.search(r"veredito:\s*approve", text) else "changes"

    def build(self) -> dict:
        self.load_progress()
        if self.progress:
            self.report(title=f"Retomando de onde parou (já feito: {', '.join(self.progress)})")
        if not self.done("site-analyst"):
            self.report("analyzing", "Analisando o site")
            self.run_role("site-analyst", self.task_text("site-analyst"))
            self.mark_done("site-analyst")
        report = self.work / "SITE_REPORT.md"
        if not report.exists():
            raise StepFailed("analyzing", "o site-analyst não entregou SITE_REPORT.md")
        if "INVIAVEL" in report.read_text(encoding="utf-8")[:4000]:
            summary = report.read_text(encoding="utf-8")[:600]
            raise StepFailed("analyzing", f"site inviável segundo a análise: {summary}")
        self.report("building", "Construindo o conector")
        for role in ("connector-builder", "test-writer"):
            if not self.done(role):
                self.run_role(role, self.task_text(role))
                self.mark_done(role)
        self.report("testing", "Testando")
        for round_no in range(FIX_ROUNDS + 1):
            fixed = f"connector-fixer:{round_no + 1}"
            if self.done(fixed):
                continue  # rodada inteira ja feita antes da pausa
            gate = self.gate()
            self.report(title=f"Portão (rodada {round_no}): {'passou' if gate['ok'] else 'reprovou'}",
                        log=json.dumps({k: gate[k] for k in ('ok', 'files_outside_scope')}, ensure_ascii=False)
                        + "\n" + gate["pytest"]["output"][-1500:])
            reviewed = f"qa-reviewer:{round_no}"
            if not self.done(reviewed):
                self.run_role("qa-reviewer", self.task_text("qa-reviewer"))
                self.mark_done(reviewed)
            if gate["ok"] and self.review_verdict() == "approve":
                return gate
            if round_no == FIX_ROUNDS:
                break
            self.run_role("connector-fixer", self.task_text("connector-fixer", round_no + 1))
            self.mark_done(fixed)
        raise StepFailed("testing", "o conector não passou no portão depois das rodadas de correção")

    def deploy(self, gate: dict) -> None:
        msg = (f"Add {self.source_id} connector (autoconnector request {self.req.get('id')})\n\n"
               f"Created by the autoconnector subagents. Gate: pytest + live probe passed.\n\n"
               f"Co-Authored-By: autoconnector <noreply@jandson.me>")
        self.sh(["git", "add", "-A"], cwd=self.wt)
        self.sh(["git", "reset", "-q", "HEAD", "backend/autoconnector/work"], cwd=self.wt, check=False)
        self.sh(["git", "commit", "-q", "-m", msg], cwd=self.wt)
        self.sh(["git", "-C", str(self.repo), "merge", "--no-ff", "-q", "-m",
                 f"Merge autoconnector/{self.req.get('id')} ({self.source_id})", f"autoconnector/{self.req.get('id')}"])
        pushed = subprocess.run(["git", "-C", str(self.repo), "push", "-q"], capture_output=True, text=True, timeout=120)
        if pushed.returncode != 0:
            self.report(title="Aviso: o commit ficou só no servidor (git push sem credencial)", log=pushed.stderr[-500:])
        if self.runtime == "venv":
            code, out = self.proc([str(self.venv / "bin" / "pip"), "install", "-q", "-e", str(self.repo / "backend")],
                                  env=self.venv_env(), timeout=1800)
            if code != 0:
                raise RuntimeError(f"pip install saiu com {code}: {out[-1500:]}")
            self.run_oghma("upgrade-db")
            self.run_oghma("seed-sources")
            restart = cfg("AUTOCONNECTOR_RESTART_CMD", "sudo -n systemctl restart oghma-rodizio").split()
            if restart:
                code, out = self.proc(restart, timeout=120)
                if code != 0:
                    self.report(title="Aviso: não consegui reiniciar o rodízio", log=out[-500:])
            return
        self.sh(["docker", "compose", "build", "-q", "api", "crawler"], cwd=self.compose_dir, timeout=1800)
        self.sh(["docker", "compose", "up", "-d", "api"], cwd=self.compose_dir)
        self.run_oghma("upgrade-db")
        self.run_oghma("seed-sources")

    def crawl_requested_and_publish(self) -> None:
        self.report("downloading", "Baixando a novel pedida")
        target = ["--novel-url", self.req["novelUrl"]] if self.req.get("novelUrl") else ["--limit", "3"]
        self.run_oghma("crawl", "--source", self.source_id, *target, lock=f"crawl-{self.source_id}.lock", timeout=6 * 3600)
        self.run_oghma(lock="publish.lock", timeout=3 * 3600, publish=True)

    def start_full_crawl(self) -> None:
        """Coleta completa em segundo plano; ao terminar publica e avisa no brain."""
        log = f"{cfg('OGHMA_LOG_DIR', '/srv/oghma/logs')}/crawl-{self.source_id}-first.log"
        if self.runtime == "venv":
            # Na VPS o rodizio (oghma-rodizio) pega a fonte nova sozinho depois do restart do deploy.
            self.report(title=f"Coleta completa de {self.source_id} entra no rodízio")
            self._watch_new_source()
            return
        script = (
            f"cd {self.compose_dir} && "
            f"flock {self.lock_dir}/crawl-{self.source_id}.lock docker compose run --rm --no-deps crawler oghma crawl --source {self.source_id} && "
            f"flock {self.lock_dir}/publish.lock docker compose run --rm --no-deps crawler python -m oghma.publish --source {self.source_id} && "
            f"brain notify 'Coleta completa de {self.source_id} publicada' --level success --app oghma --thread oghma-src-{self.req.get('id')} "
            f"|| brain notify 'Coleta completa de {self.source_id} falhou' --level error --app oghma --thread oghma-src-{self.req.get('id')} --body 'Log: {log}'"
        )
        subprocess.Popen(["nohup", "sh", "-c", script], stdout=open(log, "a"), stderr=subprocess.STDOUT,
                         start_new_session=True)
        env_file = Path("/srv/oghma/.env.daily-crawl")
        if env_file.exists():
            text = env_file.read_text()
            match = re.search(r"^OGHMA_DAILY_SOURCES=\"?([^\"\n]*)\"?", text, re.M)
            if match and self.source_id not in match.group(1).split():
                new = f'OGHMA_DAILY_SOURCES="{(match.group(1) + " " + self.source_id).strip()}"'
                env_file.write_text(text.replace(match.group(0), new))
        self._watch_new_source()

    def _watch_new_source(self) -> None:
        monitor = Path(cfg("AUTOCONNECTOR_WORK", "/home/codex/oghma-autoconnector")) / "monitor.json"
        data = json.loads(monitor.read_text()) if monitor.exists() else {}
        data[self.source_id] = {"request_id": self.req.get("id"), "remaining": 3, "since": time.time()}
        monitor.write_text(json.dumps(data, indent=2))

    def run(self) -> None:
        started = time.time()
        try:
            existing = None if self.rebuild else self.existing_source()
            if existing:
                self.source_id = existing
                self.report("downloading", f"{self.domain} já é uma fonte ({existing}): só baixando a novel pedida")
                if self.deploy_enabled:
                    self.crawl_requested_and_publish()
                self.report(status="live", stage="live", source_id=existing, title=f"Pronta: {existing}", level="success")
                return
            self.prepare_worktree()
            save_current(self.req)
            gate = self.build()
            novel_title = (gate.get("probe") or {}).get("novel", {}).get("title")
            if not self.deploy_enabled:
                self.report(title="Ensaio concluído sem deploy (--no-deploy)", level="success", novel_title=novel_title)
                return
            self.report("downloading", "Portão aprovado: fazendo deploy")
            self.deploy(gate)
            self.crawl_requested_and_publish()
            self.start_full_crawl()
            total = self.cost_summary()["total"]
            minutes = round((time.time() - started) / 60)
            self.report(status="live", stage="live", source_id=self.source_id, novel_title=novel_title, level="success",
                        title=f"{self.domain} no ar" + (f": {novel_title} já disponível" if novel_title else ""),
                        body=(f"Fonte `{self.source_id}` criada em {minutes} min. Tokens: {num(total['input_tokens'] + total['output_tokens'])}"
                              f" (mais {num(total['cached_input_tokens'])} em cache). Custo equivalente Claude: US$ {total['cost_usd']:.2f}. "
                              f"Uso do plano (pontos da janela de 5 h): {self.cost_summary()['plan_5h_points_used']}. "
                              "A coleta completa continua em segundo plano."))
            clear_current(self.req)
        except WaitPlan as exc:
            label = back_label(exc.at)
            self.report(status="queued", stage="waiting_plan", message=f"Aguardando plano, volta às {label}",
                        retry_at=datetime.fromtimestamp(exc.at, timezone.utc).isoformat(),
                        title=f"Sem plano nos motores: {exc.role} retoma às {label}")
            clear_current(self.req)
            return
        except StepFailed as exc:
            clear_current(self.req)
            self.report(status="failed", stage="failed", level="error", title=f"Não foi possível criar a fonte ({exc.stage})",
                        body=str(exc)[:1500], message=str(exc)[:300], log=str(exc))
        except Exception as exc:  # qualquer falha vira aviso, o worktree fica para analise
            clear_current(self.req)
            self.report(status="failed", stage="failed", level="error", title="Erro inesperado no autoconnector",
                        body=str(exc)[:1500], message=str(exc)[:300], log=traceback.format_exc()[-4000:])


# ------------------------------------------------------------------ pedido em andamento (retomada)

def _current_path() -> Path:
    return Path(cfg("AUTOCONNECTOR_WORK", "/home/codex/oghma-autoconnector")) / "current.json"


def save_current(request: dict) -> None:
    path = _current_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(request, ensure_ascii=False))


def clear_current(request: dict) -> None:
    path = _current_path()
    try:
        if json.loads(path.read_text()).get("id") == request.get("id"):
            path.unlink()
    except (OSError, ValueError):
        pass


def interrupted_request() -> dict | None:
    """Pedido que estava em construcao quando o worker parou (reinicio, queda)."""
    try:
        return json.loads(_current_path().read_text())
    except (OSError, ValueError):
        return None


# ------------------------------------------------------------------ monitoramento

def recent_runs() -> list | None:
    """Ultimas coletas: pela CLI do venv (VPS, sem API) ou pela API do compose."""
    try:
        if cfg("AUTOCONNECTOR_RUNTIME", "docker") == "venv":
            venv = Path(cfg("OGHMA_VENV", "/opt/oghma/venv"))
            env = {**os.environ, **read_env_file(cfg("OGHMA_ENV_FILE", "/opt/oghma/.env"))}
            proc = subprocess.run([str(venv / "bin" / "oghma"), "crawl-runs", "--limit", "50"],
                                  capture_output=True, text=True, timeout=120, env=env)
            return json.loads(proc.stdout) if proc.returncode == 0 else None
        with urllib.request.urlopen(cfg("OGHMA_CRAWLS_URL", "http://127.0.0.1:8010/api/crawls?limit=50"), timeout=20) as resp:
            return json.loads(resp.read().decode())
    except (urllib.error.URLError, OSError, ValueError, subprocess.SubprocessError):
        return None


def monitor_new_sources(brain: Brain) -> None:
    """Nas primeiras coletas de uma fonte nova, avisa se falhou ou veio com muitos capitulos invalidos."""
    path = Path(cfg("AUTOCONNECTOR_WORK", "/home/codex/oghma-autoconnector")) / "monitor.json"
    if not path.exists():
        return
    data = json.loads(path.read_text())
    runs = recent_runs()
    if runs is None:
        return
    changed = False
    for source, info in list(data.items()):
        seen = set(info.get("seen", []))
        for run in runs:
            if run.get("sourceId") != source or run["id"] in seen or run.get("status") == "running":
                continue
            seen.add(run["id"])
            stats = run.get("stats") or {}
            new, invalid = int(stats.get("chapters_new") or 0), int(stats.get("chapters_invalid") or 0)
            ratio = invalid / max(1, new + invalid)
            if run.get("status") == "error" or ratio > 0.05:
                brain.notify(level="error", thread=f"oghma-src-{info.get('request_id')}",
                             title=f"Alerta na coleta de {source}",
                             body=f"Execução {run['id']}: status {run.get('status')}, {invalid} capítulos inválidos de {new + invalid}. "
                                  f"{(run.get('error') or '')[:300]}")
            info["remaining"] = int(info.get("remaining", 3)) - 1
        info["seen"] = sorted(seen)
        if info["remaining"] <= 0:
            data.pop(source)
        changed = True
    if changed:
        path.write_text(json.dumps(data, indent=2))


# ------------------------------------------------------------------ entrada

def available_engines():
    return [e for e in (CodexEngine(), ClaudeCodeEngine()) if e.available()]


def main() -> int:
    load_env_file()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("loop")
    sub.add_parser("once")
    run_p = sub.add_parser("run")
    run_p.add_argument("--url", required=True)
    run_p.add_argument("--engine", choices=["codex", "claude"])
    run_p.add_argument("--source-id")
    run_p.add_argument("--no-deploy", action="store_true")
    run_p.add_argument("--rebuild", action="store_true", help="recria mesmo se o dominio ja for uma fonte (ensaio)")
    args = parser.parse_args()

    engines = available_engines()
    if not engines:
        print("nenhum motor logado (codex ou claude)", file=sys.stderr)
        return 1
    force = getattr(args, "engine", None) or cfg("AUTOCONNECTOR_ENGINE") or None

    if args.cmd == "run":
        u = urlsplit(args.url)
        domain = (u.hostname or "").removeprefix("www.")
        request = {"id": f"local{int(time.time()) % 100000:05d}", "url": args.url, "domain": domain,
                   "novelUrl": args.url if u.path.strip("/") else None, "sourceId": args.source_id}
        brain = Brain(cfg("BRAIN_URL", "https://brain.jandson.me"), cfg("BRAIN_TOKEN")) if cfg("BRAIN_TOKEN") else NullBrain()
        if isinstance(brain, Brain) and not isinstance(brain, NullBrain):
            brain = _LocalRunBrain(brain, request, force)
        Pipeline(request, brain, engines, force_engine=force, deploy=not args.no_deploy and not args.rebuild,
                 rebuild=args.rebuild).run()
        return 0

    brain = Brain(cfg("BRAIN_URL", "https://brain.jandson.me"), cfg("BRAIN_TOKEN"))
    pending = interrupted_request()
    if pending:
        print(f"[worker] retomando pedido interrompido {pending.get('id')}", flush=True)
        Pipeline(pending, brain, engines, force_engine=force).run()
    while True:
        monitor_new_sources(brain)
        try:
            request = brain.next_request()
        except (urllib.error.URLError, OSError) as exc:
            print(f"[brain] sem conexão: {exc}", flush=True)
            request = None
        if request:
            Pipeline(request, brain, engines, force_engine=force).run()
        if args.cmd == "once":
            return 0
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    sys.exit(main())
