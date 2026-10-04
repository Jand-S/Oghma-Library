"""`oghma discovery-fichas`: a ficha da historia de cada obra, escrita uma vez pelo Codex.

A ficha (protagonista, premissa, mundo, tom, estrutura, tracos marcantes) e um texto padronizado
que o `discovery-build` usa no lugar da sinopse para comparar historias. Sinopses sao textos de
divulgacao, cada uma num estilo; as fichas deixam obras parecidas com textos parecidos.

Roda o Codex como o usuario dos agentes (AUTOCONNECTOR_AGENT_USER, sem os segredos do .env), em
lotes de 20 obras com raciocinio "low". So gera para obras sem ficha ou cuja entrada mudou (hash
de titulo, autor, tags e sinopse). Grava depois de cada lote: pode parar a qualquer momento e
continua de onde parou. Para sozinho perto do limite do plano (janela de 5 h ou semanal) para
nao travar o autoconnector, que usa o mesmo plano.
"""
from __future__ import annotations

import glob
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Callable, Optional

from .similar import DiscoveryNovel, _plain

BATCH = 20
SYNOPSIS_CHARS = 1800
# Para antes de esgotar o plano: o autoconnector precisa de folga para um pedido de fonte.
MAX_FIVE_HOUR = float(os.environ.get("OGHMA_FICHAS_MAX_5H", "85"))
MAX_WEEKLY = float(os.environ.get("OGHMA_FICHAS_MAX_WEEKLY", "90"))

PROMPT = """Você escreve FICHAS DA HISTÓRIA de light novels e web novels, para um sistema que recomenda obras parecidas.
Cada ficha precisa descrever a história de forma específica e padronizada, para que duas obras com histórias
parecidas tenham fichas parecidas, e duas obras só do mesmo gênero NÃO tenham.

Para cada obra da lista (JSON abaixo), use a sinopse e o que você sabe COM CERTEZA da obra pelo título e autor.
Se você não conhece a obra, use só a sinopse e marque "known": false. Nunca invente fatos.

Campos (em português, frases curtas e concretas):
- "protagonista": quem é, personalidade, origem, poder ou vantagem, o que busca.
- "premissa": o conflito ou gancho central da história.
- "mundo": ambientação e regras marcantes (ex.: escola de elite com sistema de pontos; mundo de pesadelos que invade a Terra).
- "tom": sensação de leitura (ex.: sombrio com humor seco; comédia romântica leve; tensão psicológica).
- "estrutura": como a história anda (ex.: regressão com conhecimento do futuro; masmorras e níveis; intriga política; slice of life).
- "tracos": 3 a 5 traços que DIFERENCIAM a obra de outras do mesmo gênero. Proibido traço genérico como
  "ação", "aventura", "magia", "fica mais forte", "mundo perigoso", "monstros", "sistema" sem dizer o que tem de especial.
- "known": true se você conhece a obra além da sinopse.

Responda SOMENTE com um array JSON, um objeto por obra, na mesma ordem, com o "id" de entrada:
[{"id": "...", "known": true, "protagonista": "...", "premissa": "...", "mundo": "...", "tom": "...", "estrutura": "...", "tracos": ["...", "..."]}]
"""


class PlanLimit(RuntimeError):
    """O plano do Codex chegou perto do limite (ou recusou por limite): continua na proxima rodada."""


def source_hash(novel: DiscoveryNovel) -> str:
    """O que a ficha leu: se titulo, autor, tags ou sinopse mudarem, a ficha e refeita."""
    raw = json.dumps([novel.title, novel.author or "", sorted(novel.tags), _plain(novel.description)[:SYNOPSIS_CHARS]],
                     ensure_ascii=False)
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:16]


def pending(novels: list[DiscoveryNovel], fichas: dict[str, dict]) -> list[DiscoveryNovel]:
    """Obras sem ficha ou com entrada nova. Fichas antigas sem `_src` (piloto) valem como estao."""
    out = []
    for novel in novels:
        ficha = fichas.get(novel.id)
        if ficha is None or ("_src" in ficha and ficha["_src"] != source_hash(novel)):
            out.append(novel)
    return out


def batch_payload(novels: list[DiscoveryNovel]) -> str:
    items = [{"id": n.id, "title": n.title, "author": n.author or "", "tags": n.tags,
              "synopsis": _plain(n.description)[:SYNOPSIS_CHARS]} for n in novels]
    return PROMPT + "\n\nObras:\n" + json.dumps(items, ensure_ascii=False)


def parse_fichas(text: str, novels: list[DiscoveryNovel]) -> dict[str, dict]:
    """Fichas validas do lote (ids conhecidos, campos de texto), marcadas com o hash da entrada."""
    by_id = {n.id: n for n in novels}
    try:
        arr = json.loads(text[text.index("["): text.rindex("]") + 1])
    except ValueError:
        return {}
    out = {}
    for item in arr if isinstance(arr, list) else []:
        if not isinstance(item, dict) or item.get("id") not in by_id:
            continue
        if not any(isinstance(item.get(k), str) and item[k].strip() for k in ("premissa", "protagonista")):
            continue
        ficha = {k: item.get(k) for k in ("known", "protagonista", "premissa", "mundo", "tom", "estrutura", "tracos")}
        ficha["_src"] = source_hash(by_id[item["id"]])
        out[item["id"]] = ficha
    return out


def save_fichas(path: Path, fichas: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(fichas, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)


def plan_usage() -> Optional[tuple[float, float]]:
    """(% da janela de 5 h, % semanal) da ultima sessao do Codex do usuario dos agentes."""
    home = os.environ.get("AUTOCONNECTOR_AGENT_HOME") or os.path.expanduser("~")
    files = sorted(glob.glob(os.path.join(home, ".codex", "sessions", "**", "*.jsonl"), recursive=True),
                   key=os.path.getmtime)
    for path in reversed(files[-5:]):
        last = None
        try:
            with open(path, encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    if '"rate_limits"' in line:
                        last = line
        except OSError:
            continue
        if not last:
            continue
        limits = _find(json.loads(last), "rate_limits") or {}
        five = (limits.get("primary") or {}).get("used_percent")
        week = (limits.get("secondary") or {}).get("used_percent")
        if five is not None and week is not None:
            return float(five), float(week)
    return None


def _find(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        obj = list(obj.values())
    if isinstance(obj, list):
        for value in obj:
            found = _find(value, key)
            if found is not None:
                return found
    return None


def check_plan() -> None:
    usage = plan_usage()
    if usage and (usage[0] >= MAX_FIVE_HOUR or usage[1] >= MAX_WEEKLY):
        raise PlanLimit(f"plano do Codex em {usage[0]:.0f}% (5 h) e {usage[1]:.0f}% (semana)")


def codex_run(task: str, workdir: str, timeout: int = 900) -> tuple[str, dict]:
    """Uma chamada ao Codex como o usuario dos agentes, sem rede nem escrita fora de `workdir`."""
    out_file = os.path.join(workdir, "last.txt")
    cmd = [os.environ.get("CODEX_BIN", "codex"), "exec", "--json", "--skip-git-repo-check", "-C", workdir,
           "--sandbox", "read-only", "-c", 'model_reasoning_effort="low"', "--output-last-message", out_file, "-"]
    user = os.environ.get("AUTOCONNECTOR_AGENT_USER")
    if user:
        home = os.environ.get("AUTOCONNECTOR_AGENT_HOME", f"/var/lib/{user}")
        cmd = ["sudo", "-n", "-u", user, "--", "/usr/bin/env", "-i", f"HOME={home}", f"USER={user}",
               "PATH=/opt/oghma/.local/bin:/usr/local/bin:/usr/bin:/bin", "LANG=C.UTF-8", *cmd]
    proc = subprocess.run(cmd, input=task, capture_output=True, text=True, timeout=timeout)
    usage = {"input": 0, "cached": 0, "output": 0}
    errors = []
    for line in proc.stdout.splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get("type") == "turn.completed":
            u = event.get("usage") or {}
            usage["input"] += int(u.get("input_tokens", 0))
            usage["cached"] += int(u.get("cached_input_tokens", 0))
            usage["output"] += int(u.get("output_tokens", 0)) + int(u.get("reasoning_output_tokens", 0))
        elif event.get("type") in ("error", "turn.failed"):
            errors.append(json.dumps(event)[:300])
    joined = " ".join(errors).lower() + proc.stderr[-500:].lower()
    if "usage limit" in joined or "rate limit" in joined or " 429" in joined:
        raise PlanLimit("o Codex recusou por limite do plano")
    try:
        text = Path(out_file).read_text(encoding="utf-8")
    except OSError:
        text = ""
    return text, usage


def generate(novels: list[DiscoveryNovel], path: Path, *, limit: Optional[int] = None,
             run: Callable[[str, str], tuple[str, dict]] = codex_run, check: Callable[[], None] = check_plan,
             log=print) -> dict:
    """Gera as fichas pendentes em lotes, gravando depois de cada um."""
    fichas = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    todo = pending(novels, fichas)
    if limit is not None:
        todo = todo[:limit]
    summary = {"pending": len(todo), "written": 0, "failed_batches": 0, "stopped": None,
               "usage": {"input": 0, "cached": 0, "output": 0}}
    workdir = tempfile.mkdtemp(prefix="oghma-fichas-")
    os.chmod(workdir, 0o777)  # o usuario dos agentes grava a resposta aqui
    try:
        for start in range(0, len(todo), BATCH):
            try:
                check()
            except PlanLimit as exc:
                summary["stopped"] = str(exc)
                break
            batch = todo[start:start + BATCH]
            started = time.time()
            try:
                text, usage = run(batch_payload(batch), workdir)
            except PlanLimit as exc:
                summary["stopped"] = str(exc)
                break
            except subprocess.TimeoutExpired:
                text, usage = "", {}
            for key in summary["usage"]:
                summary["usage"][key] += usage.get(key, 0)
            got = parse_fichas(text, batch)
            if not got:
                summary["failed_batches"] += 1
            fichas.update(got)
            summary["written"] += len(got)
            save_fichas(path, fichas)
            log(f"fichas: {summary['written']}/{len(todo)} ({time.time() - started:.0f}s, {len(got)}/{len(batch)} no lote)")
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
    summary["total"] = len(fichas)
    return summary
