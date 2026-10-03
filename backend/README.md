# Oghma Library — backend

Indexa sites de novel, guarda **tudo (metadados + capitulos) no servidor local** e expoe uma API rapida para o app desktop. O cron atualiza; o app consome do banco/FS, sem tocar no site.

Stack: Python 3.11 + FastAPI + PostgreSQL 16 + SQLAlchemy async + httpx/selectolax. Hoje roda num venv na VPS, sob systemd (`deploy/RUNTIME.md`); o Docker abaixo e o runtime antigo. Conectores novos: `autoconnector/CONTEXT.md`. Historico das decisoes em `../docs/archive/`.

## Deploy (no servidor codex, com Docker)

A partir do seu PC Windows, na pasta `backend/`:

```powershell
deploy\deploy.ps1            # copia para codex@192.168.0.42 e roda o bootstrap
```

Ou direto no servidor:

```bash
bash deploy/bootstrap.sh
```

Isso sobe Postgres + API, cria o schema e as fontes. Depois:

```bash
docker compose run --rm crawler oghma probe https://centralnovel.com/series/   # calibrar seletores
docker compose run --rm crawler oghma crawl --source central-novel --limit 3 --chapter-limit 5
```

API em `http://192.168.0.42:8000` (docs em `/docs`).

## CLI

| comando | o que faz |
|---|---|
| `oghma init-db` | cria extensoes (pg_trgm/unaccent) e tabelas |
| `oghma seed-sources` | insere as fontes conhecidas |
| `oghma probe <url>` | baixa a pagina e mostra o que cada seletor acha (calibracao) |
| `oghma crawl --source central-novel [--limit N] [--chapter-limit M] [--refresh]` | roda um crawl (cron chama isso) |
| `oghma serve` | sobe a API (dev) |

## Dev local (sem Docker)

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
export OGHMA_DATABASE_URL=postgresql+asyncpg://oghma:oghma@localhost:5432/oghma
oghma init-db && oghma seed-sources
pytest         # testes de parsing (sem rede)
```

## Calibracao dos seletores

Os seletores do Central Novel partem do padrao Madara e **precisam ser conferidos** com `oghma probe`. Ajuste as constantes em `src/oghma/scraper/connectors/central_novel.py` conforme o que o probe mostrar.

## Adicionar um novo site

1. Crie `src/oghma/scraper/connectors/<site>.py` implementando o `SiteConnector`.
2. Importe-o em `connectors/__init__.py` (auto-registro via `register(...)`).
3. Adicione a fonte em `seed-sources`.
