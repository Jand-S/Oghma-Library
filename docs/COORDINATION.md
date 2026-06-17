# Coordenacao — Oghma (codex x Cowork)

Fonte unica de "quem mexe em que", estado atual e proximos passos. Atualizar a cada rodada.

Dois agentes trabalham no mesmo repo:
- **codex**: roda **no servidor** `codex@192.168.0.42` (tem Postgres, B2, scraping ao vivo, deploy). Dono do scraper/infra.
- **Cowork (eu)**: trabalho no **repo montado** (PC do Jandson). **Nao** alcanco a LAN nem faco scraping ao vivo; valido por sintaxe + testes stdlib. Dono do `publish/` e do desktop.

> Regra anti-conflito: cada arquivo tem **um dono**. Arquivos compartilhados (lista abaixo) so mudam com aviso. O repo na pasta do Jandson e a fonte da verdade; o codex sincroniza suas mudancas do servidor pra ca.

---

## 1. O que temos agora (16/06/2026)

### Backend real (servidor)
- API rodando: `http://192.168.0.42:8010` (porta 8000 ocupada pelo Comfy).
- `db` (Postgres 16) + `api` via Docker Compose; Postgres healthy.
- Storage no HDD de 4TB: bind mount `/srv/oghma` (no servidor mapeado em `/var/snap/docker/common/oghma`).
- Conector **Central Novel calibrado** contra o HTML real (tema Madara/Tsundoku; lista de capitulos vem inline pra maioria das obras).
- `pytest` no container: 3 passed.
- Crawl de prova: banco com **6 novels / 25 capitulos**; endpoint de conteudo validado (200).
- Atualizacao codex: crawl agora baixa bytes das capas e preenche `novel.cover_path`; testes no container passaram (`5 passed`). Primeiras capas preservadas em `covers/central-novel/*.png` (`86-eighty-six`, `a-monster-who-levels-up`, `a-returners-magic-should-be-special`).
- Atualizacao codex: descoberta principal do Central Novel mudou para `https://centralnovel.com/series/list-mode/`, que retorna 232 obras em `.soralist a[href*='/series/']`.
- Atualizacao codex: o caso `A Returner’s Magic Should Be Special` nao precisava de AJAX; a lista estava inline, mas os links nao tinham `capitulo` na URL. O seletor de capitulos foi ampliado para `.eplister li > a`; banco agora tem 42 capitulos no total, com 5 capitulos nessa obra.
- Atualizacao codex: crawl completo do Central Novel iniciado com telemetria viva. O run atual grava progresso em `crawl_run.stats`, publica `GET /api/crawls`, escreve log em `/srv/oghma/logs/crawl-central-novel.log` e pode ser acompanhado por `/home/codex/oghma/deploy/crawl-status.sh`.
- Atualizacao codex: cron mensal instalado para `03:00` do dia 1 de cada mes via `/home/codex/oghma/deploy/crawl-monthly.sh`. O script usa `flock`, entao nao roda duas instancias do mesmo crawl ao mesmo tempo.

### Distribuicao estatica (nuvem)
- **B2 + Cloudflare validado**: `https://b2.jandson.me` serve o bucket `oghma-acervo` (egress gratis via Cloudflare). Bucket **publico** por enquanto.
- Endpoint S3: `https://s3.us-east-005.backblazeb2.com`, regiao `us-east-005`.

### Desktop (mock)
- App Tauri+React pronto, atras da fronteira `BackendClient`. Onboarding com "servidor de index". UI nao precisa mudar pra trocar o provider.

### Docs
- `BACKEND_STACK.md`, `CONNECTOR_SPEC.md`, `API_CONTRACTS.md`, `DISTRIBUTION.md`, `STORAGE_SETUP.md`, `IMPLEMENTATION_PLAN.md`, `scraper-sites.md`, `backend/HANDOFF.md`.

---

## 2. Donos dos arquivos (evitar conflito)

| Area | Dono | Arquivos |
|---|---|---|
| Scraper/conectores | **codex** | `backend/src/oghma/scraper/**` (inclui `connectors/central_novel.py`, `orchestrator.py`, `normalize.py`, `fetcher.py`) |
| Modelos/DB/migr | **codex** | `backend/src/oghma/models.py`, `db.py` |
| API HTTP | **codex** | `backend/src/oghma/api/**` |
| Infra/deploy servidor | **codex** | `backend/docker-compose.yml`, `Dockerfile`, `deploy/**`, `.env` (no servidor) |
| **Publish (export estatico)** | **Cowork** | `backend/src/oghma/publish/**` (NOVO) |
| Desktop | **Cowork** | `apps/desktop/**` |
| Storage helper | compartilhado | `backend/src/oghma/storage.py` (Cowork le; mudar so com aviso) |
| Config | compartilhado | `backend/src/oghma/config.py` (Cowork evita; le S3 via env) |

### Compartilhados que mudam com aviso
- `backend/pyproject.toml` — Cowork vai **adicionar `boto3`** (1 linha na lista de deps). codex: ao rebuildar a imagem, manter `boto3`.
- `backend/src/oghma/cli.py` — Cowork vai **registrar o sub-app `publish`** (1-2 linhas). codex: nao remover.
- Docs em `docs/**` — qualquer um edita, mas **anexar** (nao reescrever blocos do outro).

---

## 3. O que a Cowork precisa que o codex faca (dependencias do publish)

1. **Capas no crawl**: confirmar que o crawl **baixa o arquivo da capa** (bytes) pra `/srv/oghma/covers/<source>/<slug>.<ext>`, nao so guarda a `cover_url` do site. Se hoje so guarda a URL, ajustar o orchestrator/connector pra baixar (preservacao de verdade). [bloqueia o passo de covers do publish]
   - Status codex: feito para o pipeline de crawl. TODO: **backfill** das 3 capas que falharam (Lord of Mysteries, Reverend Insanity, Shadow Slave: cover_url presente, cover_path NULL) + retry/backoff no download. No container o caminho e `/srv/oghma/covers/...`; no host com Docker snap aparece em `/var/snap/docker/common/oghma/files/covers/...` e fisicamente no HDD `/srv/oghma/files/covers/...`.

   Particionado por site (`<source>` = id da fonte):
   - disco (servidor): `/srv/oghma/covers/<source>/<slug>.<ext>`
     - Central Novel: `/srv/oghma/covers/central-novel/supreme-magus-20230101.jpg`
     - Novel Mania:   `/srv/oghma/covers/novel-mania/<slug>.jpg`
   - key no B2: `covers/<source>/<slug>.<ext>`  ->  URL final (Cloudflare):
     - Central Novel: `https://b2.jandson.me/covers/central-novel/supreme-magus-20230101.jpg`
     - Novel Mania:   `https://b2.jandson.me/covers/novel-mania/<slug>.jpg`
   - no `catalog.sqlite`, `cover_url` guarda o **caminho relativo** (`covers/<source>/<slug>.<ext>`), que o
     cliente resolve contra a base configurada (hoje `https://b2.jandson.me`). Assim o mesmo catalogo
     funciona se a base mudar (R2, outro dominio, ou ate leitura local).
2. **boto3 na imagem**: depois que a Cowork adicionar `boto3` ao `pyproject.toml`, rebuildar a imagem (`docker compose build`).
3. **Credenciais S3 no `.env`** do servidor (nunca commit):
   `OGHMA_S3_ENDPOINT=https://s3.us-east-005.backblazeb2.com`, `OGHMA_S3_REGION=us-east-005`,
   `OGHMA_S3_BUCKET=oghma-acervo`, `OGHMA_S3_ACCESS_KEY_ID=<keyID>`, `OGHMA_S3_SECRET_ACCESS_KEY=<applicationKey>`.
4. **Rodar o publish** (e onde tem Postgres + B2):
   `docker compose run --rm crawler oghma publish --source central-novel --no-upload` (gera local, confere) ->
   depois sem `--no-upload`.

---

## 4. O que a Cowork vai mexer (proximos passos meus)

1. Novo pacote `backend/src/oghma/publish/`:
   - `catalog.py` — gera `catalog.sqlite` por site (schema do `DISTRIBUTION.md` + FTS5) a partir do Postgres.
   - `bundles.py` — `<slug>.vN.tar.gz` por novel + `content_hash`/versao (incremental).
   - `covers.py` — espelha `/srv/oghma/covers/...` pro bucket (so as que mudaram; sem recompressao).
   - `uploader.py` — boto3 (R2/B2), upload na ordem atomica (bundles -> catalog -> index.json), credenciais via env.
   - `state.py` — `publish_state.json` em `/srv/oghma` (versoes ja publicadas; index.json agrega todos os sites).
   - `commands.py` — `oghma publish ...`.
   - Edicoes minimas: `cli.py` (registrar) e `pyproject.toml` (+boto3).
2. Validacao local (stdlib): `content_hash`, schema+insert do sqlite (`sqlite3`), empacotamento `tar.gz`, merge do `index.json`, `--dry-run` do uploader.
3. Depois do publish rodando: **desktop** `StaticBundleBackendClient` (le `index.json` -> baixa catalogos por site -> mescla num `library.sqlite` local -> baixa bundle por novel sob demanda) e onboarding aceitando URL do bucket.

Formato v1: **gzip** (stdlib). zstd e thumbnail de capa (Pillow) ficam como upgrade.

---

## 5. O que o codex vai mexer (proximos passos dele)

1. **Capas no crawl** (item 3.1 acima) — prioridade, pois destrava o publish completo.
2. **Normalizar conteudo para HTML semantico**: hoje o capitulo salvo carrega o wrapper do site
   (`<div class="epcontent entry-content" style="font-family:'Fira Sans';...">`), classes e estilos inline.
   Ajustar o `normalize` pra guardar so o **conteudo limpo** (`<p>`, `<em>/<strong>`, `<img>`, `<blockquote>`,
   `<hr>`), SEM wrapper/classes/estilos. Manter o **raw HTML** como esta (arquivo bruto p/ reprocesso).
   Motivo: tipografia/tema passam a ser nossos (app/EPUB), arquivos menores e portaveis. O conteudo servido
   pela API e no bundle do B2 e HTML semantico (1 arquivo por capitulo).
   - Status codex: feito no normalizador allowlist. `content_path` agora remove wrapper, classes, estilos inline,
     scripts/anuncios e preserva so `<p>`, `<em>`, `<strong>`, `<img>`, `<blockquote>`, `<hr>`.
     Tambem foi criado `oghma reprocess-content --source central-novel` para regenerar conteudo limpo a partir
     dos `raw_path` ja salvos, sem rebaixar do site.
     Validacao no servidor: `pytest` no container passou (`9 passed`); `reprocess-content` regenerou `1507`
     capitulos com `0` raws ausentes; crawl antigo foi interrompido e o crawl novo iniciou como run `8`.
3. **Descoberta completa do catalogo** (hoje so pega ~50 de `/series/`): testar `/lista-a-z/` e a paginacao
   real; trocar a fonte de descoberta se preciso.
4. **Capitulos via AJAX** pra obras longas (caso `A Returner's Magic Should Be Special` entrou sem
   capitulos): achar o endpoint `admin-ajax.php` e implementar o fallback.
5. **boto3 + env + rodar publish**: rebuildar a imagem com `boto3`; por as 5 vars `OGHMA_S3_*` no `.env`;
   rodar `oghma publish --source central-novel --no-upload` e depois sem `--no-upload`.
6. **Cron mensal** (`deploy/cron.example`) — so depois que descoberta + capitulos estiverem completos.
7. **Nao** editar `backend/src/oghma/publish/**` (e da Cowork) exceto para executar.

> Atualizacoes de status: o codex **reporta** (ex.: "feito"), a Cowork mantem este arquivo para evitar
> dois editores no mesmo doc. COORDINATION.md e de dono **Cowork**.

---

## 6. Ordem geral (paralela)

```
codex:   [capas: FEITO] -> [normalize HTML semantico: FEITO] -> [descoberta completa] -> [capitulos AJAX] -> [boto3+env] -> [rodar publish] -> [cron]
Cowork:  [publish: catalog/bundles/covers/uploader] -> (espera codex rodar) -> [desktop StaticBundleBackendClient]
```

Ponto de encontro: quando a Cowork terminar o `publish` e o codex rodar no servidor, validamos
`https://b2.jandson.me/ind


## 8. Publish v1 — pronto (Cowork), aguardando rodar (codex)

Pacote novo `backend/src/oghma/publish/` (isolado, roda via `python -m oghma.publish`; build so com stdlib,
`boto3` so no upload). Testes stdlib passando (catalog/bundles/covers/hash). `boto3` adicionado ao
`pyproject.toml`.

Como o codex roda no servidor (dentro do container `crawler`):
1. Build local, sem subir (valida geracao; nao precisa de boto3 nem de credenciais):
   `docker compose run --rm crawler python -m oghma.publish --source central-novel --no-upload`
   -> gera em `/srv/oghma/publish/` (`catalog/<source>-<ts>.sqlite.gz`, `content/.../*.tar.gz`, `index.json`).
   Conferir o sqlite (`PRAGMA`/SELECTs) e abrir um bundle.
2. Subir de verdade: `docker compose build` (pega o boto3) + por `OGHMA_S3_*` no `.env`, depois:
   - `... python -m oghma.publish --source central-novel --dry-run`  (lista as operacoes de upload)
   - `... python -m oghma.publish --source central-novel`            (sobe na ordem atomica: bundles -> covers -> catalog -> index.json)
3. Validar: `curl https://b2.jandson.me/index.json` deve retornar o manifesto com o site central-novel.

Observacoes:
- O state fica em `/srv/oghma/publish_state.json` (so e salvo apos upload real; `--no-upload`/`--dry-run` nao persistem).
- Incremental: re-rodar so re-sobe bundles cujo conteudo mudou; `--full` forca tudo.
- Capas: sobe so as dos novels que mudaram e que tem `cover_path` (as 3 sem capa entram quando o backfill rodar).

---

## Próxima tarefa do codex: reorganizar `apps/desktop/src`

Status: **pendente** (Cowork não consegue — ambiente sem `mv`/`rm`/`git` e corrompe escrita grande).

Passo-a-passo completo em **`docs/REORG_FOR_CODEX.md`**. Resumo:
- Remover lixo: `split_appui.py`, `refactor_app1.py`, `__rmtest.tmp`, `.fuse_hidden*`.
- `git mv`: `appConfig.ts`/`types.ts`/`windowControls.ts` → `src/core/`; `mockBackend.ts` → `src/services/`; todos os `*.test.*` → `src/test/`.
- Corrigir imports (tabela no doc; loop `tsc --noEmit`).
- Validar (`tsc` + `npm test`) e commitar.

Contexto: a divisão de `styles.css` e `appUi.tsx` já foi feita (ver `docs/STRUCTURE.md`). Esta reorg é o acabamento final antes de subir no GitHub.

---

## Atualizacao codex: reorg desktop concluida (17/06/2026)

---

## Atualizacao codex: House Saikai em andamento (17/06/2026)

- Novo conector local: `backend/src/oghma/scraper/connectors/house_saikai.py`.
- Fonte registrada no seed como `house-saikai` / `House Saikai`.
- Regra anti-comics: o conector usa apenas `GET /api/stories` com `format=1`; nao consulta `/comics`.
- API publica validada parcialmente:
  - catalogo `stories?...format=1...` respondeu 200 sem Bearer;
  - detalhe/lista de capitulos vem de `stories?...slug=<slug>&relationships=...separators.releases`;
  - capítulos observados usam URL publica `https://housesaikai.net/ler/series/<slug>/<releaseId>/<releaseSlug>`.
- Conteudo: o conector monta `GET /api/releases/<releaseId>?relationships=releaseText`
  e normaliza `release_text.content`/`releaseText.content` quando vier JSON; ha fallback para HTML renderizado.
- Autenticacao: o Bearer visto no navegador e opcional via `OGHMA_HOUSE_SAIKAI_BEARER`. O curl fornecido nao contem refresh token;
  nao commitar token real.
- Testes sinteticos adicionados em `backend/tests/test_house_saikai.py`.
- Pendente validar live no servidor quando comandos remotos/testes voltarem:
  `docker compose run --rm crawler oghma crawl --source house-saikai --limit 1 --chapter-limit 1`.

- Removido lixo temporario em `apps/desktop/src`: `__rmtest.tmp` e `.fuse_hidden*`.
- `appConfig.ts`, `types.ts` e `windowControls.ts` foram movidos para `src/core/`.
- `mockBackend.ts` foi movido para `src/services/`.
- Todos os testes foram movidos para `src/test/`.
- Imports corrigidos e validados com `tsc --noEmit`.
- Validacoes executadas: `npm test`, `npm run build`, `npm run tauri:check`.
- Raiz de `src/` ficou apenas com `main.tsx`, `App.tsx`, `appUi.tsx` e pastas.
