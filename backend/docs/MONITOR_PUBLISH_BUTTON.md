# Botão "Publicar no B2" no /monitor (guia para o codex)

Objetivo: um botão no painel `/monitor` que dispara `oghma publish --source central-novel`
sem `--no-upload`, mostra o andamento e o resultado (sucesso/erro + resumo).

O `runner.run()` já é **async** e usa `get_settings()` + `SessionLocal` (os mesmos do
processo da API) e lê as credenciais `OGHMA_S3_*` do ambiente. Então a forma mais simples
é chamar `run()` direto dentro da API como tarefa em segundo plano — **não** precisa
shell-out para `docker compose run`.

## 1. Estado do job (em memória)

`src/oghma/api/publish_jobs.py`:

```python
from __future__ import annotations
import asyncio, time
from typing import Any

# Um job por vez é suficiente para o publish.
_state: dict[str, Any] = {"status": "idle", "startedAt": None, "finishedAt": None,
                          "summary": None, "error": None}
_lock = asyncio.Lock()

def snapshot() -> dict: return dict(_state)

async def run_publish(source_id: str) -> None:
    from ..publish.runner import run
    from ..config import get_settings
    settings = get_settings()
    out_dir = str(__import__("pathlib").Path(settings.storage_root) / "publish")
    async with _lock:
        if _state["status"] == "running":
            return
        _state.update(status="running", startedAt=time.time(),
                      finishedAt=None, summary=None, error=None)
    try:
        summary = await run(source_id, out_dir=out_dir)   # upload real
        _state.update(status="done", summary=summary, finishedAt=time.time())
    except Exception as e:  # noqa
        _state.update(status="error", error=repr(e), finishedAt=time.time())
```

## 2. Endpoints

No router da API (onde já vive `/monitor`):

```python
from fastapi import APIRouter, BackgroundTasks
from ..api import publish_jobs

router = APIRouter()

@router.post("/api/publish/run")
async def publish_run(background: BackgroundTasks, source: str = "central-novel"):
    snap = publish_jobs.snapshot()
    if snap["status"] == "running":
        return {"ok": False, "reason": "already_running", "job": snap}
    background.add_task(publish_jobs.run_publish, source)
    return {"ok": True, "job": publish_jobs.snapshot()}

@router.get("/api/publish/status")
async def publish_status():
    return publish_jobs.snapshot()
```

`BackgroundTasks` roda depois de devolver a resposta, no mesmo processo (que tem acesso ao
banco e ao `/srv/oghma`). Como o publish é incremental, rodar de novo é barato e seguro.

## 3. Botão + polling no /monitor (HTML/JS)

```html
<button id="btn-publish">Publicar no B2</button>
<span id="publish-status">idle</span>

<script>
const el = document.getElementById("publish-status");
async function poll() {
  const r = await fetch("/api/publish/status");
  const j = await r.json();
  let txt = j.status;
  if (j.status === "done" && j.summary)
    txt = `ok — ${j.summary.novels} novels, ${j.summary.bundles_changed} bundles, ${j.summary.covers} capas`;
  if (j.status === "error") txt = "erro: " + j.error;
  el.textContent = txt;
  if (j.status === "running") setTimeout(poll, 2000);
}
document.getElementById("btn-publish").onclick = async () => {
  el.textContent = "disparando…";
  await fetch("/api/publish/run", { method: "POST" });
  poll();
};
poll();
</script>
```

## 4. Notas

- O `run()` faz a ordem atômica bundles -> capas -> catalog(.sqlite + .json) -> index.json,
  e só persiste o `publish_state.json` se o upload real terminou. Se cair no meio, o
  `index.json` antigo continua válido (clientes não quebram).
- O resumo agora inclui `catalog_json_key` (o catálogo leve que o desktop consome).
- Para multi-site no futuro: aceite `source` no POST e, se quiser, faça um loop pelos
  sites habilitados antes de subir o `index.json` (ele é montado a partir do state, então
  publicar cada site sequencialmente já agrega todos no índice).
- Se preferir isolar o publish do processo da API (memória/CPU), troque o BackgroundTask por
  `asyncio.create_subprocess_exec("docker","compose","run","--rm","crawler", ...)` e leia o
  stdout JSON — mas aí o container precisa do socket do Docker, o que é mais chato. A versão
  in-process acima é a recomendada.
