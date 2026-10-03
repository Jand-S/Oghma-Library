# Backend stack — decisao de tecnologia

Objetivo: indexar e **guardar tudo (metadados + todos os capitulos) no servidor local**, e expor uma API rapida para o desktop. O cron (mensal) atualiza o acervo; o app consome do banco/arquivos, **nunca acessa o site na hora do download**. Precisa escalar para muitos sites/novels/capitulos e responder filtros/cruzamentos rapido.

## Escolhas e porque

| Camada | Escolha | Por que |
|---|---|---|
| Linguagem | **Python 3.11** (async) | Melhor ecossistema de scraping; alinhado com a doc. |
| API | **FastAPI + Uvicorn + Pydantic v2** | Async, rapido, gera OpenAPI (facilita o desktop). |
| Banco | **PostgreSQL 16** | Integridade relacional source→novel→chapter, indices fortes para filtros/cruzamentos, `JSONB` para metadado flexivel por site, `ARRAY`+GIN para tags. Escala para milhoes de linhas. |
| Busca | **Postgres FTS (`tsvector`) + `pg_trgm`** | Busca textual e fuzzy de titulo sem subir outro servico. (Meilisearch/Typesense ficam como upgrade futuro se precisar de ranking melhor.) |
| ORM/migra | **SQLAlchemy 2.0 async (asyncpg)** | Tipado, adaptavel; modelos = camada de dominio. (v0 usa `create_all`; Alembic entra depois.) |
| Storage de capitulos | **Filesystem em `/srv/oghma`** (gzip) + caminho/hash no banco | Mantem o DB leve e rapido; corpos de capitulo sao grandes e quase nunca entram em filtro, so sao lidos por chave. Backup trivial. (MinIO/S3 opcional se virar multi-no.) |
| Scraper HTTP | **httpx (async) + selectolax + tenacity** | `selectolax` (lexbor) e parser HTML **muito** rapido; `tenacity` cuida de retry/backoff. Rate-limit por dominio. |
| JS sites (futuro) | **Playwright** atras da mesma interface de fetcher | Novel Mania e similares entram sem mudar o resto. |
| EPUB | **ebooklib** | Monta EPUB a partir do conteudo normalizado guardado. |
| CLI/orquestracao | **Typer** + **cron do sistema** | `crawl` roda no cron mensal; `probe` calibra seletores; `init-db` cria schema. Sem fila pesada no inicio (downloads = leitura de DB/FS). `arq`/Redis entra se a concorrencia crescer. |
| Deploy | **Docker Compose** (postgres + api) | Um comando sobe tudo no servidor. Cron chama a CLI no container. |

## Modelo de dados (nucleo)

- `source_site(id, name, base_url, mode, enabled, rate_limit_seconds, novel_count, last_sync_at)`
- `novel(id="<source>:<slug>", source_id, slug, title, author, description, cover_url, cover_path, language, status, tags[], chapter_count, source_url, extra jsonb, search_tsv, datas)`
- `chapter(id="<novelId>#<n>", novel_id, number, title, source_url, content_path, raw_path, content_hash, word_count, downloaded, fetched_at)`
- `crawl_run(id, source_id, started_at, finished_at, status, stats jsonb, error)`

Indices para os filtros serem rapidos:
- GIN em `novel.search_tsv` (FTS), GIN trigram em `novel.title` (fuzzy), GIN em `novel.tags`.
- btree em `novel.status`, `novel.source_id`, `novel.chapter_count`.
- unique em `chapter(novel_id, number)`.

IDs canonicos: `novel.id = "<sourceId>:<slug>"`, `chapter.id = "<novelId>#<number>"`. Evita colisao entre sites e estabiliza o incremental.

## Layout de storage (`/srv/oghma`)

```
/srv/oghma/
  raw/<source>/<slug>/<n>.html.gz      # html bruto fiel ao site (reprocessavel)
  content/<source>/<slug>/<n>.html     # HTML semantico limpo servido/exportado
  covers/<source>/<slug>.jpg
  exports/<novelId>-<faixa>.epub
```

`content/*.html` deve conter apenas tags semanticas permitidas (`<p>`, `<em>`, `<strong>`, `<img>`, `<blockquote>`, `<hr>`). Wrappers do site, classes, estilos inline, scripts, anuncios e atributos de layout ficam apenas no raw bruto e nao entram no conteudo servido pela API ou publicado nos bundles.

## Fluxo

1. **cron mensal** -> `oghma crawl --source central-novel` -> abre `crawl_run`.
2. conector descobre/atualiza novels (listagem `/series/`), salva metadados + capa.
3. para cada novel, lista capitulos; baixa **so os novos** (incremental por `chapter.id`), salva raw + conteudo normalizado + hash.
4. desktop chama a **API** -> tudo vem do banco/FS, **sem tocar no site**.
5. export EPUB monta a partir do conteudo guardado.

## Operacao e visualizacao

O backend tambem serve uma pagina operacional simples em `/monitor`.

URL atual:

```text
http://192.168.0.42:8010/monitor
```

Essa pagina existe para acompanhar crawls sem precisar consultar Swagger ou SQL. Ela faz polling a cada 2 segundos em:

- `GET /api/crawls?limit=12`
- `GET /api/stats`

O `crawl_run.stats` e atualizado durante a execucao com:

- etapa atual (`stage`);
- progresso de novels (`novels_done` / `novels_total`);
- novel atual (`current_novel_title`);
- progresso de capitulos da novel atual (`current_novel_chapters_done` / `current_novel_chapters_total`);
- capitulo atual;
- capitulos novos/pulados;
- erros;
- ultimo evento;
- heartbeat (`last_heartbeat_at`).

Regra operacional: se um run estiver `running` e ficar mais de 10 minutos sem atualizar `last_heartbeat_at`, o monitor/script devem marcar como possivel travamento (`STALE?`). A recuperacao continua sendo incremental: rodar novamente pula capitulos ja salvos.

## Adaptabilidade (proximos sites)

Um site = um modulo em `oghma/scraper/connectors/<site>.py` implementando `SiteConnector` e registrado no `registry`. Rate-limit, storage, dedup, incremental e API sao **genericos**. Trocar HTML->Playwright e so trocar o fetcher daquele conector.

## Limitacoes desta fase (transparencia)

- Os seletores do Central Novel partem do padrao Madara/WordPress e **precisam ser calibrados contra o HTML real** — por isso existe `oghma probe`, que roda no servidor e imprime o que cada seletor encontra.
- O scraping ao vivo e a validacao de DB/API so acontecem **no servidor** (o ambiente de desenvolvimento nao alcanca a LAN nem o PyPI).
