# Plano de implementacao

Este documento organiza o projeto em tres visoes:

1. O que ja existe.
2. O que ainda falta implementar.
3. Em que ordem vale atacar o trabalho real.

Ele deve virar a referencia operacional principal quando comecarmos backend, scraper e integracao real.

## 1. O que ja existe hoje

### Desktop mockado

- App desktop em `apps/desktop`.
- Stack definida: Tauri 2 + React + TypeScript + Vite.
- Fronteira de dados criada em `apps/desktop/src/services/backendClient.ts`.
- Config persistida isolada em `apps/desktop/src/appConfig.ts`.
- Camada visual consolidada em `apps/desktop/src/appUi.tsx`.
- Tema visual dark com cor principal `#00796B`.
- Sidebar expansivel, titlebar customizada e footer de status.
- Busca mockada com filtros, grade de novels e selecao de cards.
- Painel lateral de configuracao de capitulos.
- Cards da fila de capitulos compactos, com expansao sob demanda.
- Fila de downloads mockada com estados `queued`, `downloading` e `done`.
- Biblioteca local mockada.
- Assistente de primeira abertura com:
  - servidor
  - pasta de saida
  - fontes
  - preferencias
  - sincronizacao inicial mockada
- Fluxo mockado de Kindle com validacao `EPUB -> AZW3`.
- Testes automatizados do frontend cobrindo os fluxos principais.

### Ajustes estruturais concluidos antes do backend real

- O desktop deixou de depender diretamente do mock como arquitetura principal.
- O contrato `BackendClient` ja existe e deve ser mantido como porta de entrada unica para dados.
- Os defaults do app nao ficam mais espalhados entre mock, onboarding e testes.
- O app ja tem tratamento basico de erro para boot, busca, validacao de servidor, downloads e Kindle.
- A leitura do estado salvo localmente agora suporta schema parcial e payload invalido.

### Documentacao e contratos

- [ARCHITECTURE.md](</C:/Users/Jandson/Documents/Oghma Library/docs/ARCHITECTURE.md>)
- [API_CONTRACTS.md](</C:/Users/Jandson/Documents/Oghma Library/docs/API_CONTRACTS.md>)
- [PROJECT_STATE.md](</C:/Users/Jandson/Documents/Oghma Library/docs/PROJECT_STATE.md>)
- [ROADMAP.md](</C:/Users/Jandson/Documents/Oghma Library/docs/ROADMAP.md>)
- [scraper-sites.md](</C:/Users/Jandson/Documents/Oghma Library/docs/references/technical/scraper-sites.md>) com os sites iniciais listados.

### O que ainda nao existe de verdade

- `apps/api`
- `packages/scraper`
- `packages/core`
- `infra`
- banco real
- storage real
- crawler real
- exportador EPUB real
- integracao desktop <-> backend real

## 2. Backlog por frente

## A. Fundacao do repositorio

### Ja existe

- `apps/desktop`
- docs base e contratos iniciais

### Falta

- criar `apps/api`
- criar `packages/scraper`
- criar `packages/core` para tipos, DTOs e regras compartilhadas
- criar `infra` com compose/local env
- definir convencoes de config `.env`

### Entregavel

- monorepo com os modulos principais criados e inicializados

## B. Modelo de dominio e persistencia

### Falta

- schema inicial do banco
- entidades reais:
  - `source_site`
  - `novel`
  - `chapter`
  - `crawl_run`
  - `crawl_cursor`
  - `asset`
  - `export_job`
- estrategia de versionamento de conteudo
- convencao de IDs canonicos por site

### Entregavel

- migracoes iniciais
- tipos compartilhados em `packages/core`

## C. Scraper e conectores

### Falta

- contrato executavel de conector
- pipeline de fetch -> raw html -> parse -> normalizacao
- estrategia incremental real
- rate limit por dominio
- tratamento de falhas/retries
- armazenamento de cursor por fonte

### Ordem interna sugerida

1. conector `static_html`
2. conector `javascript_required`
3. heuristica incremental
4. observabilidade de runs

### Status atual da observabilidade

- Primeira versao implementada no backend real:
  - progresso vivo em `crawl_run.stats`;
  - endpoint `GET /api/crawls`;
  - pagina visual `GET /monitor`;
  - endpoint de resumo `GET /api/stats`;
  - log persistido por fonte;
  - script `crawl-status.sh` com contagens, run atual, etapa, obra atual, capitulo atual e alerta `STALE?`;
  - cron mensal com `flock`.
- Como usar: ver [OPERATIONS.md](</C:/Users/Jandson/Documents/Oghma Library/docs/OPERATIONS.md>).
- Proximo passo de UX: levar a mesma informacao para uma tela interna do desktop consumindo `/api/crawls` e exibindo uma barra por `source_id`, preparado para crawls paralelos por site.

### Entregavel

- primeiro conector funcionando e gravando novels/capitulos reais

## D. Storage e assets

### Falta

- layout real em `/srv/oghma`
- MinIO/S3 ou fallback em filesystem local
- persistencia de:
  - capas
  - html bruto
  - conteudo limpo
  - EPUBs
  - futuramente AZW3, PDF, TXT e audio

### Entregavel

- backend conseguindo salvar e recuperar assets com caminho previsivel

## E. Exportacao EPUB

### Falta

- pipeline real para montar EPUB
- metadados, capa, indice e capitulos
- sanitizacao do HTML
- validacao do arquivo gerado

### Entregavel

- primeiro EPUB valido gerado a partir de capitulos reais

## F. API local

### Falta

- bootstrap real
- endpoints de fontes
- busca de novels
- detalhe de novel/capitulos
- criacao de downloads
- fila de jobs
- exports
- status de jobs
- status do Kindle

### Entregavel

- API consumivel pelo desktop, mesmo que sem auth no inicio

## G. Desktop integrado ao backend

### Ja existe

- UX principal mockada
- onboarding mockado
- states e telas principais
- fronteira `BackendClient` pronta para receber o cliente HTTP real
- persistencia local normalizada e desacoplada do mock

### Falta

- criar implementacao HTTP real de `BackendClient`
- trocar o provider injetado no `App` do mock para o cliente HTTP
- buscar fontes reais no onboarding
- sincronizacao inicial real
- busca real
- detalhes reais da novel
- downloads reais
- exports reais

### Entregavel

- app desktop operando contra API local real

## H. Operacao local e scheduler

### Falta

- compose para desenvolvimento
- worker/scheduler
- job mensal ou configuravel por fonte
- evoluir logs/monitor para multiplos sites e historico filtravel

### Entregavel

- stack rodando no servidor local em `/srv/oghma`

## I. Pos-MVP

### Falta depois do basico

- biblioteca pessoal real
- importacao manual de livros
- Kindle via USB real
- conversao AZW3 real
- traducao por IA
- audiobook/TTS

## 3. Ordem recomendada para comecar

## Fase 1 - Base tecnica

### Objetivo

Criar o chao para que scraper e API nao nascam descartaveis.

### Fazer agora

1. criar `apps/api`
2. criar `packages/core`
3. criar `packages/scraper`
4. criar `infra`
5. definir `.env` e paths locais
6. definir schema inicial

### Resultado esperado

- repositorio pronto para trabalho real

## Fase 2 - Primeiro caminho fim a fim

### Objetivo

Ter um fluxo real minimo da fonte ate o EPUB.

### Fazer

1. implementar um conector real para um site mais simples
2. salvar `novel` e `chapter` no banco
3. salvar capa e html bruto
4. gerar o primeiro EPUB

### Resultado esperado

- primeira novel real preservada localmente

## Fase 3 - API de leitura

### Objetivo

Expor os dados reais para o desktop sem depender mais do mock.

### Fazer

1. `GET /api/bootstrap`
2. `GET /api/sources`
3. `GET /api/novels`
4. `GET /api/novels/:id/chapters`
5. `POST /api/server/validate`

### Resultado esperado

- onboarding e busca conseguem usar backend real

## Fase 4 - Integrar o desktop

### Objetivo

Trocar uma fatia do mock por backend real sem reescrever a UI.

### Fazer

1. criar cliente HTTP no desktop
2. plugar onboarding no backend real
3. plugar busca real
4. plugar tela de fontes

### Resultado esperado

- app mostrando catalogo real

## Fase 5 - Jobs de download e export

### Objetivo

Entrar no fluxo central do produto.

### Fazer

1. `POST /api/downloads`
2. job de download por novel/faixa
3. status de fila
4. `POST /api/exports`
5. download/abertura do EPUB gerado

### Resultado esperado

- usuario consegue baixar e exportar livros reais

## Fase 6 - Segunda fonte e robustez

### Objetivo

Provar que a arquitetura aguenta mais de um tipo de site.

### Fazer

1. adicionar um conector `javascript_required`
2. melhorar incremental
3. logs de crawl
4. retries/backoff

### Resultado esperado

- arquitetura validada para multiplos sites

## Fase 7 - Operacao continua

### Fazer

1. scheduler configuravel
2. compose da stack local
3. evoluir observabilidade atual (`/monitor`, `/api/crawls`, `/api/stats`) para historico filtravel e multi-site
4. backup/retencao basica

### Resultado esperado

- servidor local consegue manter o acervo atualizado

## 4. Primeira ordem pratica que eu recomendo

Se formos comecar agora de verdade, eu seguiria exatamente assim:

1. criar `apps/api`, `packages/core`, `packages/scraper` e `infra`
2. definir schema do banco e os DTOs compartilhados
3. implementar um conector real para o site mais simples
4. gerar o primeiro EPUB real
5. criar os endpoints de leitura da API
6. ligar onboarding e busca do desktop a essa API
7. implementar fila/download/export
8. adicionar o segundo site

## 5. Onde eu comecaria primeiro

### Recomendacao

Comecar pelo primeiro caminho vertical real:

`site simples -> scraper -> banco -> EPUB -> API de leitura -> desktop`

### Motivo

Porque ele valida o nucleo do produto cedo:

- sabemos se o scraping funciona
- sabemos se a modelagem aguenta
- sabemos se o EPUB final fica bom
- sabemos se a UI mockada realmente atende o caso real

## 6. Proxima tarefa concreta

Minha sugestao para a proxima rodada de implementacao e:

1. criar a estrutura do monorepo real faltante
2. subir `apps/api` com FastAPI
3. criar `packages/core` com modelos compartilhados
4. escolher o primeiro site para implementar de verdade

Se quisermos reduzir risco, eu comecaria pelo site com HTML mais estatico entre `Central Novel` e `Novel Mania`, depois deixaria o site com JS para a segunda rodada.


## 7. Decisao de site e proxima tarefa (16/06/2026)

### Primeiro site escolhido: Central Novel

Analise tecnica feita nesta data (ver `docs/references/technical/scraper-sites.md`):

- **Central Novel**: WordPress + tema Madara. A home volta **HTML renderizado no servidor** (~200 links `/series/...`). URLs estaveis e previsiveis. Da para integrar **sem navegador headless**. Escolhido como primeiro conector.
- **Novel Mania**: pelo fetch HTTP simples, **nem a home nem `/novels` devolveram conteudo** (SPA ou anti-bot). Mais dificil -> fica para a 2a rodada (`javascript_required`, inspecionar API via DevTools).

### Existe API no site?

- Central Novel (WordPress) tem 3 caminhos JSON/HTTP para tentar antes de raspar HTML: **REST API (`/wp-json/`)**, **AJAX do Madara (`admin-ajax.php`)** e **RSS (`/feed/`)**. Por isso o conector adota **"API-first com fallback HTML"** (ver `docs/CONNECTOR_SPEC.md`).
- Ressalva: as rotas de API nao puderam ser confirmadas pela ferramenta de fetch da analise (provavel Cloudflare/JSON nao exposto). **Confirmar na 1a sessao de implementacao** com httpx + UA de navegador, e registrar de volta em `scraper-sites.md`.
- Novel Mania nao e WordPress; eventual API so aparece inspecionando a aba Network no navegador.

### Mudancas que isso exige antes do backend (ja documentadas)

1. `API_CONTRACTS.md` completado e alinhado 1:1 com `BackendClient` + `types.ts`, incluindo a secao **"DTO real x tipos da UI"** (camada de adaptacao no cliente HTTP).
2. `CONNECTOR_SPEC.md` criado: contrato executavel do `SiteConnector` + plano do Central Novel.
3. Decisao de IDs canonicos (`<sourceId>:<slug>`).

### Proxima tarefa concreta recomendada

1. Criar o esqueleto faltante do monorepo: `apps/api` (FastAPI), `packages/core` (DTOs/entidades), `packages/scraper` (conector), `infra` (compose) e `.env`.
2. Implementar o conector Central Novel seguindo `CONNECTOR_SPEC.md` (sessao 1: confirmar `/wp-json` + admin-ajax; sessao 2: discover/list/fetch/normalize).
3. Persistir `novel` + `chapter` reais e a capa.
4. Gerar o primeiro EPUB real.
5. Subir os endpoints de leitura (`/api/bootstrap`, `/api/sources`, `/api/novels`, `/api/novels/:id/chapters`) e criar `httpBackendClient.ts` no desktop para plugar sem mexer na UI.


## 8. Execucao iniciada (16/06/2026): backend Central Novel

Saiu do papel a Fase 1/2 do plano, consolidadas em `backend/` (um projeto Python instalavel, em vez de tres pacotes separados — mais simples de rodar no servidor; mapeia para core+scraper+api do plano).

Feito:
- nucleo (config/db/models/schemas/storage), framework de scraper (base/fetcher/normalize/registry/orchestrator), conector `central-novel`, API FastAPI de leitura, CLI e Docker Compose.
- decisao de stack documentada (`docs/BACKEND_STACK.md`).

Proximo (no servidor codex, fora do sandbox):
1. `deploy.ps1` -> sobe compose + schema + seeds.
2. `oghma probe https://centralnovel.com/series/` -> calibrar seletores reais.
3. `oghma crawl --source central-novel --limit 3 --chapter-limit 5` -> validar fim-a-fim.
4. confirmar `/wp-json` e admin-ajax (API-first) e ajustar o conector.
5. criar `httpBackendClient.ts` no desktop apontando para a API.

## 9. Distribuicao estatica (decidido)

Modelo escolhido para nao deixar o servidor 24/7: publicar `catalog.sqlite` + bundles por novel num bucket S3 (R2, ou B2+Cloudflare). Desenho completo em `docs/DISTRIBUTION.md`. Implementar (`oghma build-catalog`/`build-bundles`/`publish` + `StaticBundleBackendClient` no desktop) depois que o crawl do Central Novel estiver validado.

## 10. Deploy backend no servidor (16/06/2026)

Concluido:

- Backend publicado em `/home/codex/oghma` no servidor `192.168.0.42`.
- API rodando em `http://192.168.0.42:8010`.
- Postgres e storage persistindo no HDD de 4TB via `/srv/oghma`.
- Como Docker veio via snap, o Compose usa `/var/snap/docker/common/oghma`, com bind mount persistente para `/srv/oghma`.
- Central Novel calibrado para HTML real e validado com crawl pequeno.
- Banco validado com `6` novels e `25` capitulos depois dos crawls de prova.
- Endpoints validados pela LAN: `/health`, `/api/novels`, `/api/novels/{id}/chapters` e `/api/chapters/{id}/content`.

Proxima ordem recomendada:

1. Investigar obras da lista principal que entram sem capitulos, comecando por `A Returner’s Magic Should Be Special`.
2. Melhorar a descoberta completa do catalogo do Central Novel alem dos 50 itens iniciais de `/series/`.
3. Rodar crawl maior e revisar tempos/rate-limit.
4. Configurar cron mensal no servidor.
5. Criar `httpBackendClient.ts` no desktop e trocar a busca/onboarding para a API real.

Atualizacao codex (16/06/2026):

- Capas no crawl implementadas: bytes gravados em `covers/<source>/<slug>.<ext>` e `novel.cover_path` preenchido.
- Descoberta completa do Central Novel usa `/series/list-mode/`, com 232 obras no probe.
- `A Returner’s Magic Should Be Special` foi resolvido sem AJAX; os capitulos estavam inline em links sem `capitulo` na URL.
- Validacao no servidor: `pytest` no container `5 passed`; banco em `6` novels / `42` capitulos; `3` capas preservadas.
- Proximo bloqueio externo: aguardar pacote `publish/` da Cowork para rebuild com `boto3`, inserir `OGHMA_S3_*` no `.env` do servidor e rodar `oghma publish`.
