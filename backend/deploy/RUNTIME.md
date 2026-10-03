# Runtime do backend sem Docker (VPS)

Contrato para rodar o backend num venv no host, sob systemd. A imagem Docker continua funcionando igual (mesmas variáveis).

## Instalação

```bash
python3.11 -m venv /opt/oghma/venv
/opt/oghma/venv/bin/pip install -e /opt/oghma/repo/backend
# curl-impersonate (só o sky-demon-order usa): binário curl_ff no PATH ou em OGHMA_CURL_IMPERSONATE
```

O `.env` é lido do diretório de trabalho (`WorkingDirectory` do serviço) ou das variáveis de ambiente do systemd (`EnvironmentFile=`).

## Comandos

| Comando | Para que |
|---|---|
| `oghma upgrade-db` | cria/atualiza o schema (idempotente) |
| `oghma seed-sources` | cadastra as fontes conhecidas |
| `oghma rodizio [--parallel 2] [--pause-minutes 30] [--once] [--source X ...]` | serviço principal: coleta contínua, publica e libera espaço por fonte |
| `oghma crawl --source X [--novel-url URL]` | coleta manual de uma fonte ou de uma novel |
| `python -m oghma.publish --source X` | publicação manual (passa pela mesma trava) |
| `oghma publish-prune [--source X] [--keep 2] [--dry-run] [--local-only]` | apaga versões antigas de bundles/catálogos no B2 e no disco |
| `oghma probe-connector --source X [--novel-url URL]` | teste ao vivo de um conector (sai com 1 se reprovar) |

O `oghma rodizio` termina de forma limpa com SIGTERM/SIGINT: as coletas em andamento são canceladas e o `crawl_run` delas fica `error` ("parado"). Use `KillSignal=SIGTERM` e `TimeoutStopSec=60` no unit.

## Variáveis de ambiente

| Variável | Padrão | Uso |
|---|---|---|
| `OGHMA_DATABASE_URL` | `postgresql+asyncpg://oghma:oghma@localhost:5432/oghma` | banco |
| `OGHMA_STORAGE_ROOT` | `/srv/oghma` | raiz dos dados: `content/`, `assets/`, `covers/`, `raw/`, `publish/`, `reports/`, `publish_state.json`, `publish.lock` |
| `OGHMA_S3_ENDPOINT`, `OGHMA_S3_REGION`, `OGHMA_S3_BUCKET`, `OGHMA_S3_ACCESS_KEY_ID`, `OGHMA_S3_SECRET_ACCESS_KEY` | — | B2 (publicação e prune) |
| `OGHMA_PUBLISH` | `1` | `0` = o rodízio coleta mas não publica (modo de teste em paralelo) |
| `OGHMA_PUBLISH_KEEP_LOCAL` | `1` | `0` = apaga cada bundle local depois do upload confirmado (VPS) |
| `OGHMA_PUBLISH_LOCK_TIMEOUT` | `3600` | segundos esperando a trava de publicação antes de desistir |
| `OGHMA_CURL_IMPERSONATE` | — | caminho do `curl_ff`; senão PATH e `/opt/curl-impersonate` |
| `BRAIN_URL`, `BRAIN_TOKEN` | `https://brain.jandson.me`, — | avisos do rodízio (sem token: só log) |
| `OGHMA_SKY_DEMON_ORDER_COOKIE`, `OGHMA_HOUSE_SAIKAI_BEARER`, `OGHMA_LIGHT_NOVEL_PUB_COOKIE` | — | credenciais opcionais de fontes |

## Trava de publicação

Toda publicação (API, script, rodízio, `python -m oghma.publish`) passa por `fcntl.flock` em `<OGHMA_STORAGE_ROOT>/publish.lock`. Uma segunda publicação espera até `OGHMA_PUBLISH_LOCK_TIMEOUT`. O `publish_state.json` é gravado de forma atômica, e um arquivo ilegível faz a publicação falhar (não recomeça do zero).

## Unit sugerido

```ini
[Service]
User=oghma
WorkingDirectory=/opt/oghma
EnvironmentFile=/opt/oghma/.env
ExecStart=/opt/oghma/venv/bin/oghma rodizio --parallel 2
Restart=always
Nice=10
CPUQuota=60%
MemoryMax=600M
KillSignal=SIGTERM
TimeoutStopSec=60
```
