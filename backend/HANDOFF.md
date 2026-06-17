# HANDOFF — backend Oghma (Central Novel) para o agente do servidor

Voce (codex, com acesso ao terminal do servidor `codex@192.168.0.42`, hostname `xeonserver`)
vai continuar a partir daqui. Este arquivo e auto-contido. Leia tudo antes de agir.

## Estado atualizado do deploy (16/06/2026)

Este handoff foi executado ate a validacao fim-a-fim inicial:

- API em `http://192.168.0.42:8010`.
- Docker Compose rodando `db` e `api`.
- Dados persistidos no HDD `/srv/oghma` via bind mount `/var/snap/docker/common/oghma` (Docker snap).
- Central Novel calibrado contra HTML real.
- Crawls de prova executados; banco em `6` novels e `25` capitulos.
- Proximo trabalho: descoberta completa do catalogo, investigar obras sem capitulos e configurar cron mensal.
- Atualizacao codex: crawl baixa capas como bytes e preenche `cover_path`; descoberta principal usa `/series/list-mode/` (232 obras no probe); `A Returner’s Magic Should Be Special` resolvido com seletor `.eplister li > a`; banco validado com `6` novels e `42` capitulos; testes no container `5 passed`.
- Atualizacao codex: crawler agora tem telemetria viva em `crawl_run.stats`, endpoint `GET /api/crawls`, log persistido em `/srv/oghma/logs/crawl-central-novel.log`, script `/home/codex/oghma/deploy/crawl-status.sh` e cron mensal instalado para o dia 1 as 03:00. O status marca possivel travamento (`STALE?`) quando um run `running` fica mais de 10 minutos sem heartbeat.
- Atualizacao codex: normalizador agora salva `content_path` como HTML semantico allowlist (`p`, `em`, `strong`, `img`, `blockquote`, `hr`), removendo wrapper/classes/estilos/scripts/anuncios do site. Raw bruto continua preservado. Para limpar conteudo ja baixado, usar `oghma reprocess-content --source central-novel`.

## 0. Objetivo do produto

Indexar sites de novel e **guardar TUDO (metadados + todos os capitulos) no servidor local**,
no HDD de 4TB. O app desktop depois consome uma **API local** e **nunca** acessa o site na hora do
download. O cron (mensal) mantem o acervo atualizado de forma incremental.

Primeiro site: **Central Novel** (`https://centralnovel.com/`) — WordPress, tema padrao Madara,
listagens em HTML estatico (sem necessidade de navegador headless).

Docs de apoio no repo (`../docs/`): `BACKEND_STACK.md` (stack+schema), `CONNECTOR_SPEC.md`
(contrato do conector), `API_CONTRACTS.md` (API <-> desktop), `references/technical/scraper-sites.md`
(analise do site), `IMPLEMENTATION_PLAN.md` (plano geral).

## 1. Estado atual (o que JA existe)

- Backend Python completo em `~/oghma` (este repo, pasta `backend/`), **compila** (`py_compile` ok) e a
  logica de parsing do conector passou em teste de regex. **NUNCA foi executado em runtime de verdade**
  (o ambiente onde foi escrito nao tinha PyPI, Docker nem rede para a LAN). Ou seja: **a primeira execucao
  real e no servidor, e e esperado precisar de pequenos ajustes.**
- Stack: FastAPI + PostgreSQL 16 + SQLAlchemy 2.0 async (asyncpg) + httpx + selectolax + Typer. Deploy via
  Docker Compose. Busca: Postgres FTS (`tsvector`) + `pg_trgm`. Capitulos no filesystem; metadados no Postgres.
- Conector `central-novel` em `src/oghma/scraper/connectors/central_novel.py` com seletores no padrao Madara
  **marcados para CALIBRAR** (provavelmente erram em parte do HTML real).

## 2. Servidor e armazenamento (4TB)

- HDD de 4TB = `sda1`, montado em **`/srv`** (ext4). **O acervo vive no /srv.**
  - capitulos/capas/exports -> `OGHMA_STORAGE_HOST=/srv/oghma/files`
  - dados do Postgres -> `OGHMA_PG_HOST=/srv/oghma/pg`
  - codigo do backend fica em `~/oghma` (NVMe); so os DADOS no /srv.
- Pre-requisitos no servidor (rodar UMA vez, com sudo):
  ```bash
  sudo usermod -aG docker $USER          # se "permission denied ... docker.sock"
  sudo mkdir -p /srv/oghma && sudo chown -R $USER:$USER /srv/oghma
  ```
  Reabra a sessao SSH depois do `usermod` para o grupo docker valer.

## 3. Subir o backend

A partir de `~/oghma`:
```bash
bash deploy/bootstrap.sh
```
Isso: cria `.env` (de `.env.example`, ja apontando pro /srv), cria os diretorios em /srv, builda a imagem,
sobe Postgres + API, roda `oghma init-db` (extensoes pg_trgm/unaccent + tabelas) e `oghma seed-sources`.
API em `http://192.168.0.42:8000` (`/docs`, `/health`).

CLI (sempre via container): `docker compose run --rm crawler oghma <comando>`
- `init-db` | `seed-sources` | `probe <url>` | `crawl --source central-novel [--limit N --chapter-limit M --refresh]` | `serve`

Observabilidade do crawl:
```bash
/home/codex/oghma/deploy/crawl-status.sh
tail -f /srv/oghma/logs/crawl-central-novel.log
curl "http://localhost:8010/api/crawls?limit=5"
curl "http://localhost:8010/api/stats"
```

Pagina visual no backend: `http://192.168.0.42:8010/monitor`.

O script mensal usa `flock` para evitar duas execucoes simultaneas:
```bash
/home/codex/oghma/deploy/crawl-monthly.sh
```

> Se o servidor NAO tiver Docker, peca para instalar (`sudo snap install docker` ja existe aqui via snap, ou
> docker.io). Como alternativa sem Docker: criar venv, `pip install -e .`, subir um Postgres do sistema e
> exportar `OGHMA_DATABASE_URL`. Mas o caminho suportado/testado e o Docker Compose.

## 4. TAREFA IMEDIATA: calibrar os seletores do Central Novel

Os seletores em `central_novel.py` sao um chute educado (padrao Madara). **Confirme contra o HTML real** e
ajuste. Loop:

1. Listagem (descoberta de novels):
   ```bash
   docker compose run --rm crawler oghma probe https://centralnovel.com/series/
   ```
   Olhe `LIST_ITEM` — tem que achar varios links `/series/<slug>/`. Se 0 hits, inspecione o HTML
   (ex.: `curl -s -A "Mozilla/5.0" https://centralnovel.com/series/ | head -c 4000`) e ajuste `LIST_ITEM`.
   Confirme tambem a **paginacao**: a real e `/series/page/2/`? (o conector assume isso em `discover_novels`).

2. Pagina da novel (metadados + lista de capitulos):
   ```bash
   docker compose run --rm crawler oghma probe https://centralnovel.com/series/<um-slug-real>/
   ```
   Ajuste `NOVEL_TITLE`, `NOVEL_COVER`, `NOVEL_DESC`, `NOVEL_TAG`, `NOVEL_STATUS` e principalmente
   `CHAPTER_ITEM`. **Atencao**: no Madara a lista de capitulos costuma vir por AJAX
   (`POST /wp-admin/admin-ajax.php`, action `manga_get_chapters`/similar) e pode NAO estar no HTML da pagina.
   Se `CHAPTER_ITEM` der 0 hits, descubra o endpoint AJAX (DevTools/Network num navegador, ou testar
   `admin-ajax.php`) e implemente a busca de capitulos por ele em `list_chapters` (ha um fallback inicial la).

3. Pagina de capitulo (conteudo):
   ```bash
   docker compose run --rm crawler oghma probe https://centralnovel.com/<slug>-capitulo-1/
   ```
   Ajuste `CONTENT` para o container de leitura real (testar que o texto sai limpo, sem menu/ads).
   Confira o padrao do numero do capitulo na URL (o regex `_CHAPTER_NUM` cobre `capitulo-10` e `10.5`;
   se o site usar `capitulo-10-5` para decimais, ajuste o regex/normalizacao).

### API-first (preferir JSON a raspar HTML)
Antes de depender de HTML, **teste a API do WordPress** e prefira-a se cobrir:
```bash
curl -s -A "Mozilla/5.0" https://centralnovel.com/wp-json/ | head -c 2000
curl -s -A "Mozilla/5.0" https://centralnovel.com/wp-json/wp/v2/types | head -c 3000
```
Se os custom post types (series/capitulos, ex. `wp-manga`) estiverem expostos (`show_in_rest`), reescreva o
conector para consumir JSON (mais estavel). Senao, AJAX do tema; senao, HTML. Registre o que achou em
`../docs/references/technical/scraper-sites.md`.
> Obs.: na analise inicial o fetcher externo nao conseguiu ler `/wp-json` (provavel Cloudflare bloqueando
> nao-navegador). Do servidor, com `User-Agent` de navegador, normalmente funciona — confirme.

## 5. Validar fim-a-fim (definicao de pronto da fase)

```bash
docker compose run --rm crawler oghma crawl --source central-novel --limit 3 --chapter-limit 5
```
Esperado:
- 3 novels e ate 5 capitulos cada gravados.
- Arquivos em `/srv/oghma/files/raw/central-novel/...` e `/.../content/...`.
- No banco: `select count(*) from novel; select count(*) from chapter;` > 0.
- API responde: `curl http://localhost:8000/api/novels` retorna as novels;
  `curl http://localhost:8000/api/novels/<id>/chapters` pagina os capitulos;
  `curl "http://localhost:8000/api/chapters/<id>/content"` devolve o HTML limpo.

Quando isso passar, suba o `--limit`/sem limite para o crawl completo (respeitando rate-limit) e configure o
cron (`deploy/cron.example`).

## 6. Mapa de arquivos (backend/)

```
src/oghma/
  config.py        settings (.env, prefixo OGHMA_)
  db.py            engine/sessao async
  models.py        SQLAlchemy: source_site, novel, chapter, crawl_run (+ indices FTS/trigram/tags)
  schemas.py       DTOs camelCase para o desktop (camada de adaptacao DTO->UI)
  storage.py       filesystem (raw/content/covers/exports) + sha256
  scraper/
    base.py        contrato SiteConnector + dataclasses
    fetcher.py     httpx async, rate-limit por dominio, retry/backoff
    normalize.py   limpa HTML do capitulo (selectolax) -> conteudo + hash + word_count
    registry.py    registro de conectores
    orchestrator.py crawl_source(): discover->fetch->normalize->grava (incremental por chapter.id)
    connectors/central_novel.py   <-- AJUSTAR SELETORES AQUI
  api/
    main.py, routes.py, deps.py   FastAPI: /api/bootstrap, /sources, /novels, /novels/{id}/chapters,
                                  /chapters/{id}/content, /health
  cli.py           Typer: init-db, seed-sources, probe, crawl, serve
tests/test_central_novel.py       parsing com HTML sintetico (sem rede): pytest
deploy/bootstrap.sh, deploy.ps1, cron.example
docker-compose.yml, Dockerfile, .env.example, pyproject.toml
```

## 7. Convencoes e gotchas

- IDs canonicos: `novel.id = "central-novel:<slug>"`, `chapter.id = "<novel.id>#<numero>"`. Mantenha.
- Incremental: o crawl pula capitulos ja gravados (por id); `--refresh` rebaixa.
- Rate-limit: `OGHMA_DEFAULT_RATE_LIMIT_SECONDS=2.0` + jitter; nao baixar agressivo. Respeitar robots.txt.
- `Novel.search_tsv` e coluna gerada (`to_tsvector('portuguese', title || author)`), GIN. Busca por `query`
  hoje usa ILIKE simples em `routes.py`; da para evoluir para FTS/trigram com ranking.
- Adaptacao DTO->UI: o desktop espera `coverUrl` (a UI usa `coverClass` no mock; ver `API_CONTRACTS.md`).
  O proximo passo no desktop e criar `apps/desktop/src/services/httpBackendClient.ts` implementando
  `BackendClient` contra esta API, sem mexer em `appUi.tsx`.
- Seguranca: a senha do servidor NAO esta em nenhum arquivo. Considere configurar chave SSH para o cron.

## 8. Proximos passos depois do Central Novel

1. Crawl completo do Central Novel + cron mensal.
2. `httpBackendClient.ts` no desktop apontando para a API.
3. Export EPUB real (ebooklib) a partir do conteudo guardado (`POST /api/exports`).
4. Segundo site (Novel Mania): provavel SPA/anti-bot -> inspecionar API XHR no navegador ou conector
   `javascript_required` com Playwright (atras da mesma interface de fetcher).

## 9. Ao terminar cada etapa

Atualize `../docs/PROJECT_STATE.md` e `../docs/references/technical/scraper-sites.md` com o que foi
confirmado/ajustado (seletores reais, se a API JSON serve, numeros do primeiro crawl).
