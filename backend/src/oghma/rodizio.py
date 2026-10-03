"""Rodizio continuo de coleta: N fontes por vez, cada uma crawl -> publica -> evict -> aviso.

Substitui o cron mensal, a coleta diaria do ESP32 e o botao de publicar: um processo
so, sob systemd (`oghma-rodizio.service`). Fila fixa e estavel das fontes habilitadas;
quando uma fonte termina, entra a proxima; ao fim da fila, pausa e recomeca.
SIGTERM/SIGINT termina de forma limpa: as coletas em andamento sao canceladas e o
crawl_run delas fica `error` com motivo "parado".

Reinicio educado (`<storage>/rodizio.restart`, criado pelo autoconnector depois do deploy
de um conector novo): nenhuma fonte nova comeca, as que estao rodando terminam, o
processo apaga o arquivo e sai; o systemd (Restart=always) religa com o codigo novo.
Fontes que nunca tiveram uma coleta completa vao para o comeco da fila.

Fonte com MAX_FAILURES coletas seguidas com erro (padrao 3, `OGHMA_MAX_FAILURES`) sai do
rodizio (`source_site.enabled = false`) com aviso no brain; volta com `oghma source-enable`.
Continua no app: so para de ser coletada.
"""
from __future__ import annotations

import asyncio
import json
import os
import signal
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Awaitable, Callable

STOP_REASON = "parado: rodizio encerrado (SIGTERM/SIGINT)"
RESTART_FLAG = "rodizio.restart"
RESTART_POLL_SECONDS = 30.0
# Erros que nao sao culpa da fonte (parada do rodizio, queda da maquina) nao contam como falha.
NOT_SOURCE_FAULT = ("parado:", "morreu no reboot", "interrompida: o servidor")


def max_failures() -> int:
    try:
        return max(1, int(os.environ.get("OGHMA_MAX_FAILURES", "3")))
    except ValueError:
        return 3


def failure_streak(runs: list[tuple[str, str | None]]) -> int:
    """Coletas seguidas com erro, da mais nova para a mais antiga (status, erro)."""
    n = 0
    for status, error in runs:
        if status == "running":
            continue
        if status != "error":
            break
        if (error or "").startswith(NOT_SOURCE_FAULT):
            continue
        n += 1
    return n


def restart_flag_path():
    from pathlib import Path

    return Path(os.environ.get("OGHMA_STORAGE_ROOT", "/srv/oghma")) / RESTART_FLAG


def _restart_requested() -> bool:
    return restart_flag_path().exists()


def _clear_restart() -> None:
    try:
        restart_flag_path().unlink()
    except FileNotFoundError:
        pass


def _flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default).strip().lower() not in ("0", "false", "no", "")


def brain_notify(level: str, title: str, body: str = "", thread: str | None = None) -> None:
    """Aviso no brain.jandson.me. Sem BRAIN_TOKEN ou sem rede, so registra no log."""
    url, token = os.environ.get("BRAIN_URL", "https://brain.jandson.me"), os.environ.get("BRAIN_TOKEN", "")
    print(f"[rodizio] aviso {level}: {title}", flush=True)
    if not token:
        return
    payload = {"app": "oghma", "level": level, "title": title[:200], "body": body[:4000]}
    if thread:
        payload["thread"] = thread
    req = urllib.request.Request(url.rstrip("/") + "/api/notify", data=json.dumps(payload).encode(), method="POST")
    req.add_header("Authorization", f"Bearer {token}")
    req.add_header("Content-Type", "application/json")
    try:
        urllib.request.urlopen(req, timeout=20).close()
    except (urllib.error.URLError, OSError) as exc:
        print(f"[rodizio] brain indisponivel: {exc}", flush=True)


def summarize(source_id: str, stats: dict | None, error: str | None) -> tuple[str, str, str]:
    """(nivel, titulo, corpo) do aviso de uma fonte."""
    if error:
        blocked = "403" in error or "Forbidden" in error
        return ("error", f"{source_id}: {'bloqueado (403)' if blocked else 'coleta falhou'}", error[:1500])
    stats = stats or {}
    new, invalid = int(stats.get("chapters_new") or 0), int(stats.get("chapters_invalid") or 0)
    failed = int(stats.get("novels_failed") or 0)
    body = (f"{new} capítulos novos, {invalid} inválidos, {failed} novels com erro, "
            f"{stats.get('novels_done', 0)}/{stats.get('novels_total', 0)} novels.")
    if invalid or failed:
        return ("warn", f"{source_id}: {new} capítulos novos, {invalid} inválidos", body)
    if new:
        return ("success", f"{source_id}: {new} capítulos novos", body)
    return ("info", f"{source_id}: nada novo", body)


def order_sources(ids: list[str], done: set[str]) -> list[str]:
    """Fontes sem nenhuma coleta completa (recem-adicionadas) primeiro; depois a ordem fixa."""
    return [i for i in ids if i not in done] + [i for i in ids if i in done]


@dataclass
class Deps:
    """Pontos de troca para os testes (sem banco, rede nem B2)."""
    list_sources: Callable[[], Awaitable[list[str]]]
    crawl: Callable[[str], Awaitable[dict]]
    publish: Callable[[str], Awaitable[dict]]
    evict: Callable[[str], Awaitable[dict]]
    mark_stopped: Callable[[str], Awaitable[None]]
    notify: Callable[[str, str, str], None] = brain_notify
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep
    restart_requested: Callable[[], bool] = _restart_requested
    clear_restart: Callable[[], None] = _clear_restart
    failures: Callable[[str], Awaitable[int]] | None = None
    disable: Callable[[str], Awaitable[None]] | None = None


@dataclass
class Rodizio:
    deps: Deps
    parallel: int = 2
    pause_minutes: float = 30.0
    publish_enabled: bool = True
    log: list = field(default_factory=list)
    stopping: bool = False
    draining: bool = False

    def _check_restart(self) -> bool:
        if not self.draining and self.deps.restart_requested():
            self.draining = True
        return self.draining

    async def run_source(self, source_id: str, sem: asyncio.Semaphore) -> dict:
        async with sem:
            if self.stopping or self._check_restart():
                return {"source": source_id, "skipped": True}
            started = time.monotonic()
            result: dict = {"source": source_id}
            try:
                stats = await self.deps.crawl(source_id)
                result["stats"] = stats
                if (stats or {}).get("stage") == "crawl_error":
                    # crawl_source nao levanta: marca o crawl_run como error e devolve o motivo
                    raise RuntimeError(str(stats.get("last_event") or "coleta falhou"))
                if self.publish_enabled:
                    result["publish"] = await self.deps.publish(source_id)
                result["evict"] = await self.deps.evict(source_id)
                level, title, body = summarize(source_id, stats, None)
            except asyncio.CancelledError:
                await self.deps.mark_stopped(source_id)
                result["stopped"] = True
                self.log.append(result)
                raise
            except Exception as exc:  # uma fonte com erro nao para o rodizio
                result["error"] = f"{type(exc).__name__}: {exc}"
                level, title, body = summarize(source_id, None, result["error"])
                title, body = await self._count_failure(source_id, result, title, body)
            result["seconds"] = round(time.monotonic() - started, 1)
            if level != "info":
                self.deps.notify(level, title, body)
            self.log.append(result)
            return result

    async def _count_failure(self, source_id: str, result: dict, title: str, body: str) -> tuple[str, str]:
        """Conta as falhas seguidas; na ultima, tira a fonte do rodizio."""
        if self.deps.failures is None:
            return title, body
        try:
            streak, limit = await self.deps.failures(source_id), max_failures()
            result["failures"] = streak
            if streak < limit:
                return f"{title} (falha {streak} de {limit})", body
            if self.deps.disable is not None:
                await self.deps.disable(source_id)
            result["disabled"] = True
            return (f"{source_id} saiu do rodízio: {streak} coletas seguidas com erro",
                    f"A fonte continua no app, mas não é mais coletada.\n\nÚltimo erro: {body}\n\n"
                    f"Para voltar: oghma source-enable {source_id}")
        except Exception as exc:  # contar falhas nunca derruba o rodizio
            return title, f"{body}\n\n(nao consegui contar as falhas: {exc})"

    async def one_round(self, only: list[str] | None = None) -> list[dict]:
        sources = await self.deps.list_sources()
        if only:
            sources = [s for s in sources if s in only]
        sem = asyncio.Semaphore(max(1, self.parallel))
        tasks = [asyncio.create_task(self.run_source(s, sem)) for s in sources]
        self._tasks = tasks
        return list(await asyncio.gather(*tasks))

    async def run(self, *, once: bool = False, only: list[str] | None = None) -> None:
        while not self.stopping:
            await self.one_round(only)
            if once or self.stopping or self._check_restart():
                break
            await self._pause(self.pause_minutes * 60)
            if self._check_restart():
                break
        if self.draining:
            # as fontes em andamento ja terminaram; o systemd religa com o codigo novo
            self.deps.clear_restart()

    async def _pause(self, seconds: float) -> None:
        """Pausa entre voltas que acorda na hora com stop() ou com o pedido de reinicio."""
        self._wake = asyncio.Event()
        sleeper = asyncio.create_task(self.deps.sleep(seconds))
        waker = asyncio.create_task(self._wake.wait())
        poller = asyncio.create_task(self._poll_restart())
        done, pending = await asyncio.wait({sleeper, waker, poller}, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()

    async def _poll_restart(self) -> None:
        while not self._check_restart():
            await asyncio.sleep(RESTART_POLL_SECONDS)

    def stop(self) -> None:
        self.stopping = True
        wake = getattr(self, "_wake", None)
        if wake is not None:
            wake.set()
        for t in getattr(self, "_tasks", []):
            t.cancel()


def default_deps() -> Deps:
    from sqlalchemy import select

    from .db import SessionLocal
    from .models import CrawlRun, SourceSite
    from .publish.runner import run as publish_run
    from .scraper.orchestrator import crawl_source

    async def list_sources() -> list[str]:
        async with SessionLocal() as s:
            ids = list((await s.scalars(select(SourceSite.id).where(SourceSite.enabled.is_(True)).order_by(SourceSite.id))).all())
            done = set((await s.scalars(select(CrawlRun.source_id).where(CrawlRun.status == "done").distinct())).all())
        return order_sources(ids, done)

    async def crawl(source_id: str) -> dict:
        async with SessionLocal() as s:
            return await crawl_source(s, source_id)

    async def publish(source_id: str) -> dict:
        return await publish_run(source_id)

    async def evict(source_id: str) -> dict:
        try:
            from . import coldstore
        except ImportError:
            return {"skipped": "coldstore ausente"}
        async with SessionLocal() as s:
            return await coldstore.evict(s, source_id=source_id)

    async def failures(source_id: str) -> int:
        async with SessionLocal() as s:
            rows = (await s.execute(select(CrawlRun.status, CrawlRun.error).where(CrawlRun.source_id == source_id)
                                    .order_by(CrawlRun.id.desc()).limit(20))).all()
        return failure_streak([(r[0], r[1]) for r in rows])

    async def disable(source_id: str) -> None:
        async with SessionLocal() as s:
            src = await s.get(SourceSite, source_id)
            if src is not None:
                src.enabled = False
                await s.commit()

    async def mark_stopped(source_id: str) -> None:
        from datetime import datetime, timezone

        async with SessionLocal() as s:
            runs = (await s.scalars(select(CrawlRun).where(CrawlRun.source_id == source_id,
                                                           CrawlRun.status == "running"))).all()
            for r in runs:
                r.status, r.error, r.finished_at = "error", STOP_REASON, datetime.now(timezone.utc)
            await s.commit()

    return Deps(list_sources, crawl, publish, evict, mark_stopped, failures=failures, disable=disable)


async def main(*, parallel: int = 2, pause_minutes: float = 30.0, once: bool = False,
               only: list[str] | None = None, deps: Deps | None = None) -> int:
    rod = Rodizio(deps or default_deps(), parallel=parallel, pause_minutes=pause_minutes,
                  publish_enabled=_flag("OGHMA_PUBLISH"))
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, rod.stop)
        except (NotImplementedError, RuntimeError):
            pass
    try:
        await rod.run(once=once, only=only)
    except asyncio.CancelledError:
        pass
    return 0
