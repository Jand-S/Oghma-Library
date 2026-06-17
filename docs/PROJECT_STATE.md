# Project state

## Agora

- Stack escolhida para o desktop: Tauri 2 + React + TypeScript + Vite.
- O app desktop mockado existe em `apps/desktop`.
- A API continua mockada, mas agora atras de um contrato explicito em `src/services/backendClient.ts`.
- O mock atual virou apenas uma implementacao desse contrato em `src/mockBackend.ts`.
- A camada visual foi separada da orquestracao principal: `src/App.tsx` concentra estado e `src/appUi.tsx` concentra componentes/telas.
- A configuracao local foi isolada em `src/appConfig.ts`, com leitura tolerante a payload parcial ou corrompido.
- Os controles de janela agora vivem em `src/windowControls.ts`.
- O design atual usa tema dark, verde-azulado `#00796B`, sidebar expansivel, filtros laterais e painel lateral de capitulos com largura fixa.
- Testes foram adicionados para API mockada e fluxo principal do frontend.
- A titlebar nativa foi removida no Tauri e a titlebar customizada tem regiao de drag.
- No navegador comum, os botoes minimizar/maximizar/fechar apenas disparam um evento mockado; no runtime Tauri eles chamam a API real de janela.
- O mock atual inclui estado de dispositivo Kindle conectado, CTA de envio direto na aba Downloads e modal de conversao EPUB -> AZW3 com progresso.
- O app agora possui assistente de primeira abertura em etapas, com persistencia local das configuracoes iniciais.
- O planejamento operacional do trabalho real agora esta consolidado em `docs/IMPLEMENTATION_PLAN.md`.

## Ajustes estruturais (16/06/2026)

- `App.tsx` deixou de acumular persistencia local e contrato de dados; ele agora atua mais como coordenador.
- Foi criada a fronteira `BackendClient`, que e o ponto previsto para conectar o backend HTTP real depois.
- O fluxo de boot, busca, validacao de servidor, criacao de downloads, sincronizacao de fonte e envio ao Kindle agora tem tratamento de erro e mensagens de fallback.
- A configuracao salva localmente deixou de depender de `JSON.parse(...) as AppConfig`; agora ha normalizacao e merge com defaults.
- A base de testes ganhou cobertura para:
  - `localStorage` malformado
  - falha de bootstrap
  - falha de busca
  - normalizacao/resolucao de config persistida

## Ajustes de UI (rodada atual)

- As permissoes de janela do Tauri foram adicionadas em `src-tauri/capabilities/default.json` (`allow-minimize`, `allow-maximize`, `allow-unmaximize`, `allow-toggle-maximize`, `allow-close`, `allow-start-dragging`); antes disso o restore e o fechar nao funcionavam no runtime Tauri por falta de permissao.
- A sidebar retraida agora centraliza os icones (o texto colapsa com `width: 0`).
- Painel de filtros e painel de capitulos passaram a ter largura fixa (240px e 280px); o resize com `||` foi removido para simplificar o layout.
- Removido o filtro de fonte duplicado no painel de filtros: ficou apenas o select `Fonte` (a secao de checkboxes `Fontes ativas` saiu).
- Removido o dock lateral de `Fila` que aparecia em Fontes/Downloads/Biblioteca/Ajustes; essas telas agora usam largura total. A fila continua acessivel na aba Downloads.
- Scroll vertical habilitado nas grades de Fontes, Biblioteca e Ajustes; scroll horizontal eliminado (`overflow-x: hidden`) nos paineis e listas.
- Testes novos: o dock de fila nao deve aparecer fora da aba de busca, e o painel de filtros tem apenas um filtro de fonte.

## Correcoes de build/dev (Windows)

- `npm run tauri:dev` falhava com `spawn EINVAL` no `scripts/ensure-dev-server.mjs`. Causa: o Node 22 no Windows so permite spawnar `.cmd` (ex.: `npm.cmd`) com `shell: true`. Ajustado de `shell: false` para `shell: true`.
- `npm run tauri:build` gerava o `.exe` mas falhava ao empacotar o MSI com `Couldn't find a .ico icon`. Causa: `bundle.icon` estava vazio. Apontado para `icons/icon.ico` (que ja existia em `src-tauri/icons/`). Para um conjunto completo de icones por plataforma, rodar depois `npm run tauri icon caminho/para/uma/imagem.png`.

## Decisoes atuais

- A selecao de capitulos e por novel, nao global.
- Novels muito longas devem usar presets como `ultimos`, `faixa`, `ausentes` e `todos`.
- O painel de capitulos fica lateral para aproveitar espaco horizontal e manter mais cards visiveis.
- Os cards da fila de capitulos agora nascem compactos e so expandem quando o usuario quiser editar um livro especifico.
- A titlebar e customizada no Tauri, com janela sem decoracao nativa.
- O clique no card inteiro seleciona a novel; o circulo continua sendo apenas um indicador/atalho.
- A busca inicial usa o payload do bootstrap e evita uma segunda busca identica para nao piscar skeleton nem engolir cliques no inicio.
- A tela de busca nao mostra mais `Amostra de capitulos`; os capitulos detalhados devem ir para uma tela propria de novel.
- Adicionar a fila nao troca mais para a aba Downloads; o app mostra uma notificacao e mantem o usuario na busca.
- O botao principal de download ficou somente no painel de capitulos, perto da selecao por novel.
- Filtros e painel de capitulos tem largura fixa (resize `||` removido nesta rodada).
- O filtro nao tem mais estado de sidebar colapsada; quando fechado, ele sai do layout e os resultados ocupam o espaco.
- Existe apenas um botao de filtro na toolbar de resultados.
- O painel de capitulos so aparece quando ao menos uma novel esta selecionada.
- A borda de selecao dos cards usa a cor principal `#00796B`.
- Os controles da janela tem teste de fallback fora do runtime Tauri e area `no-drag` reforcada no CSS.
- O footer passa a representar o estado do Kindle com uma bolinha verde quando conectado.
- O envio direto ao Kindle so fica habilitado para downloads concluidos selecionados que possuam `EPUB`.
- Se qualquer item selecionado nao tiver `EPUB`, o CTA do Kindle fica desabilitado e deve explicar o motivo.
- Antes do envio, o app deve avisar que a transferencia converte `EPUB` para `AZW3`.
- A conversao/envio para Kindle deve expor progresso; no mock atual isso e simulado no frontend e no backend real deve virar job rastreavel.
- A primeira abertura agora passa por um wizard: bem-vindo, servidor/modo de indexacao, pasta de saida, fontes retornadas pelo servidor, preferencias e resumo final.
- Depois do resumo, o onboarding entra numa etapa obrigatoria de sincronizacao inicial dos indices das fontes selecionadas.
- O wizard salva a configuracao local do app e pode ser reaberto depois pela aba Ajustes.
- A selecao inicial de fontes no wizard passa a ser a base para quais sites ficam ativos no app.
- A pasta de saida padrao do mock ficou em `~/Documents/Oghma Library/exports`, mas o usuario pode trocar no onboarding ou nos Ajustes.

## Validacao atual

- Validado em 16/06/2026:
  - `npm.cmd test`
  - `npm.cmd run build`
  - `cargo check --manifest-path src-tauri/Cargo.toml`
- Resultado atual: testes passando, build do frontend passando e lado Rust/Tauri compilando.

## Como rodar no desktop

Pre-requisitos: Node.js LTS, Rust (rustup) e as dependencias de build do Tauri 2 para Windows (WebView2 ja vem no Windows 10/11; instalar tambem o Visual Studio Build Tools com C++).

Na pasta `apps/desktop`:

1. Instalar dependencias do frontend: `npm install`.
2. Rodar so a UI no navegador (mock, rapido): `npm run dev` e abrir o endereco do Vite.
3. Rodar o app desktop real (janela Tauri): `npm run tauri:dev`. A primeira execucao compila o lado Rust e pode demorar.
4. Conferir o lado nativo sem abrir a janela: `npm run tauri:check`.
5. Gerar o instalavel/binario: `npm run tauri:build` (saida em `src-tauri/target/release`).

Para validar as correcoes: `npm test` (vitest), `npm run build` (TypeScript + Vite) e `npm run tauri:check`.

## Proximos ajustes de UX

- Melhorar edicao manual capitulo por capitulo para novels grandes, provavelmente com paginacao/virtualizacao.
- Adicionar tela detalhada da novel.
- Adicionar view de lista alem de grade.
- Melhorar estados vazios e mensagens de erro.
- Trocar capas mockadas por imagens reais/mockadas mais proximas do produto final.

## Antes do backend real

- Consolidar contratos em `docs/API_CONTRACTS.md`.
- Definir schema do banco.
- Definir formato normalizado de capitulo.
- Definir contratos de storage para capas, HTML bruto, conteudo limpo e EPUB.
- Criar a implementacao HTTP real do `BackendClient` para substituir o mock por feature flag ou troca direta de provider.


## Regras de onboarding (mock atual)

- O onboarding deve aparecer apena


## Preparacao do backend (16/06/2026)

- Primeiro site decidido: **Central Novel** (WordPress/Madara, HTML estatico; sem navegador). Novel Mania (SPA/anti-bot) fica para a 2a rodada.
- Estrategia do conector: **API-first com fallback HTML** (`/wp-json` -> admin-ajax -> RSS -> parse HTML). A confirmar `/wp-json` e admin-ajax na implementacao.
- Docs atualizadas/criadas: `references/technical/scraper-sites.md` (analise real dos dois sites), `API_CONTRACTS.md` (completo e alinhado ao `BackendClient`, com a camada de adaptacao DTO->UI), `CONNECTOR_SPEC.md` (novo: contrato do conector + plano Central Novel), e `IMPLEMENTATION_PLAN.md` (decisao + proxima tarefa).
- Achado importante: os tipos do frontend sao moldados para mock (`coverClass`, `rangeLabel`, `progress`, `pages`, `sizeMb`). A traducao DTO real -> tipo da UI deve ficar no futuro `httpBackendClient.ts`, mantendo `appUi.tsx` intacto.


## Backend real iniciado (16/06/2026) — Central Novel

Criado o backend em `backend/` (Python 3.11). Decisao de stack em `docs/BACKEND_STACK.md`.

- **Stack**: FastAPI + PostgreSQL 16 + SQLAlchemy 2.0 async (asyncpg) + httpx/selectolax + Typer. Busca via Postgres FTS (`tsvector`) + `pg_trgm`. Capitulos guardados no filesystem (`/srv/oghma`) com caminho/hash no banco. EPUB via ebooklib (futuro). Deploy via Docker Compose.
- **Estrutura**: `backend/src/oghma/` com `config`, `db`, `models` (source_site/novel/chapter/crawl_run), `schemas` (DTOs camelCase para o desktop), `storage`, `scraper/` (base/fetcher/normalize/registry/orchestrator + `connectors/central_novel.py`), `api/` (FastAPI: bootstrap, sources, novels com filtros, chapters paginado, chapter content) e `cli.py` (init-db, seed-sources, probe, crawl, serve).
- **Adaptabilidade**: novo site = um modulo conector + registro; rate-limit, storage, dedup e incremental sao genericos.
- **Incremental**: o crawl baixa so capitulos novos (por id `novel#n`); `--refresh` rebaixa.
- **Conector Central Novel**: descobre em `/series/` (paginado), seletores no padrao Madara **marcados para calibrar** com `oghma probe` no servidor.
- **Validacao possivel no ambiente**: `py_compile` de todos os arquivos OK e teste de sanidade das regex OK. **Nao foi possivel** rodar Postgres/API/scraper aqui (sem PyPI, sem Docker, sem rota para a LAN). A validacao de execucao acontece no servidor.
- **Deploy**: `backend/deploy/deploy.ps1` (roda no PC Windows: copia para `codex@192.168.0.42` e executa `bootstrap.sh`) e `backend/deploy/bootstrap.sh` (no servidor: sobe compose, `init-db`, `seed-sources`, `up api`). Cron em `backend/deploy/cron.example`.
- **Pendente (no servidor)**: rodar `probe` para calibrar seletores, primeiro `crawl --limit`, e depois plugar o `httpBackendClient.ts` do desktop nessa API.
- Nota de seguranca: a senha do servidor nao foi escrita em nenhum arquivo do repo; recomendo configurar chave SSH.


## Servidor codex (deploy 16/06/2026)

- HDD de 4TB (`sda1`) montado em `/srv`. Decisao: o acervo vive no 4TB.
  - capitulos/capas/exports: `OGHMA_STORAGE_HOST=/srv/oghma/files`
  - dados do Postgres: `OGHMA_PG_HOST=/srv/oghma/pg`
  - codigo do backend fica em `~/oghma` (NVMe), so os dados no `/srv`.
- Pre-requisitos no servidor: usuario no grupo `docker`; `/srv/oghma` criado e com dono do usuario.
- `docker-compose.yml` aceita `OGHMA_PG_HOST` (bind do Postgres) e `OGHMA_STORAGE_HOST` (bind dos arquivos).

## Deploy backend concluido (16/06/2026)

- Backend publicado no servidor `codex@192.168.0.42`, pasta `/home/codex/oghma`.
- API disponivel em `http://192.168.0.42:8010` porque a porta `8000` ja estava em uso por outro servico (`Comfy-Ultimate`). O Compose agora usa `OGHMA_API_HOST_PORT`.
- Docker instalado via snap nao conseguia montar `/srv/oghma` diretamente. Solucao aplicada:
  - dados reais continuam em `/srv/oghma`;
  - caminho usado pelo Compose: `/var/snap/docker/common/oghma`;
  - bind mount persistido em `/etc/fstab`: `/srv/oghma /var/snap/docker/common/oghma none bind 0 0`;
  - backup criado: `/etc/fstab.oghma-backup-20260616-140734`.
- Variaveis efetivas do servidor:
  - `OGHMA_API_HOST_PORT=8010`
  - `OGHMA_STORAGE_HOST=/var/snap/docker/common/oghma/files`
  - `OGHMA_PG_HOST=/var/snap/docker/common/oghma/pg`
- Dependencia runtime adicionada: `h2>=4.1`, necessaria porque `httpx` esta usando `http2=True`.
- Central Novel calibrado no servidor:
  - listagem principal: `.listupd h2 a[href*='/series/']`
  - titulo: `h1.entry-title`
  - capa: `.bigcontent .thumb img`
  - descricao: `.entry-content[itemprop='description']`
  - generos: `.infox a[href*='/genre/']`
  - capitulos: `.eplister li > a[href*='capitulo']`
  - conteudo: `.epcontent`
- REST API do WordPress existe (`/wp-json/` e `/wp-json/wp/v2/types` retornam 200), mas nao expoe tipos custom de novels/capitulos; os tipos visiveis sao os padroes (`post`, `page`, anexos etc.). Caminho validado para o conector: HTML server-side.
- Validacao fim-a-fim:
  - `python -m pytest /tests` no container temporario: `3 passed`.
  - `GET /health` pela LAN: `{"status":"ok"}`
  - `GET /api/novels?limit=3` pela LAN retorna novels reais.
  - `GET /api/novels/central-novel:shadow-slave-20230928/chapters?pageSize=5` retorna capitulos com `downloaded=true` e `wordCount`.
  - `GET /api/chapters/central-novel:shadow-slave-20230928%231/content` retorna `200`.
  - storage confirmado: `30` arquivos apos o primeiro crawl de prova (`15` raw + `15` content); depois do segundo crawl, o banco chegou a `6` novels e `25` capitulos.
- Resultado dos crawls de prova:
  - rodada 1 com seletor da sidebar/populares: `3` novels, `15` capitulos, `0` erros.
  - rodada 2 com seletor principal: banco em `6` novels, `25` capitulos; `A Returner’s Magic Should Be Special` entrou com `0` capitulos e precisa de investigacao especifica.
- Atualizacao de coordenacao com Cowork:
  - crawl agora baixa bytes das capas, grava em `covers/<source>/<slug>.<ext>` e preenche `novel.cover_path`;
  - `RawPage` agora preserva `content_type` para detectar extensao real de capas;
  - Central Novel usa `/series/list-mode/` como descoberta principal, com `232` obras no probe;
  - seletor de capitulos ampliado para `.eplister li > a`, resolvendo obras com URLs sem `capitulo`, como `A Returner’s Magic Should Be Special`;
  - validacao no servidor: `pytest` no container `5 passed`, banco em `6` novels / `42` capitulos, `3` capas, `42` raw e `42` content.
- Proximo passo tecnico:
  - aguardar pacote `publish/` da Cowork para rebuild com `boto3`, configurar `OGHMA_S3_*` no `.env` do servidor e rodar `oghma publish`;
  - depois rodar crawl maior com `list-mode` e configurar cron mensal.

## Observabilidade do crawler (16/06/2026)

- O crawler agora grava progresso vivo em `crawl_run.stats` durante a execucao, nao apenas ao final.
- Endpoint novo: `GET /api/crawls?limit=20`, com filtros opcionais `sourceId` e `status`.
- Campos principais de progresso:
  - `stage`: `starting`, `discovered`, `fetch_novel`, `cover`, `chapters`, `skipping_existing`, `downloading_chapter`, `novel_done`, `novel_error`, `done`, `crawl_error`.
  - `novels_total`, `novels_done`, `novels_failed`, `current_novel_index`, `current_novel_title`.
  - `current_novel_chapters_total`, `current_novel_chapters_done`, `current_chapter_number`, `current_chapter_title`.
  - `chapters_seen`, `chapters_new`, `chapters_skipped`, `covers_new`, `cover_errors`, `errors`.
  - `last_event` e `last_heartbeat_at`.
- O script operacional `/home/codex/oghma/deploy/crawl-status.sh` mostra processos, ultimas linhas do log, contagens do banco, runs recentes e alerta `STALE?` se um run estiver `running` sem heartbeat ha mais de 10 minutos.
- Log persistido do crawl mensal: `/srv/oghma/logs/crawl-central-novel.log`.
- Pagina operacional criada no backend: `GET /monitor`. Ela mostra runs recentes, progresso por novels/capitulos, etapa atual, heartbeat, evento recente e resumo de contagens.
- Endpoint auxiliar de dashboard: `GET /api/stats`, com total de fontes, novels, capitulos, capas e crawls ativos.
- Runbook de uso: [OPERATIONS.md](</C:/Users/Jandson/Documents/Oghma Library/docs/OPERATIONS.md>).
- O cron mensal esta instalado no servidor:
  - `0 3 1 * * /home/codex/oghma/deploy/crawl-monthly.sh`
- A estrutura foi pensada para multiplos sites: cada execucao tem `source_id`, e a futura UI pode renderizar uma linha de progresso por site/run.
- Durante novels longas, `Novel.chapter_count` tambem passa a ser atualizado conforme os capitulos novos entram, entao `/api/novels` reflete progresso parcial.

## Normalizacao de conteudo (16/06/2026)

- `raw_path` continua preservando o HTML bruto do site em `raw/<source>/<slug>/<n>.html.gz`.
- `content_path` agora e HTML semantico limpo, sem wrapper/classes/estilos inline do site.
- Tags permitidas no conteudo servido/exportado: `<p>`, `<em>`, `<strong>`, `<img>`, `<blockquote>`, `<hr>`.
- O wrapper do Central Novel (`div.epcontent.entry-content`), atributos `style`, classes, scripts/anuncios e elementos de layout nao entram mais no `content/*.html`.
- Comando operacional criado para limpar conteudo ja baixado a partir do raw salvo: `oghma reprocess-content --source central-novel`.
- Validacao no servidor: testes do backend passaram (`9 passed`); `reprocess-content` regenerou `1507` capitulos com `0` raws ausentes; o crawl antigo foi parado e um novo crawl iniciou como run `8`.

## Publish pelo monitor (17/06/2026)

- O backend passa a expor `POST /api/publish/run` para disparar publish real do acervo estatico.
- `GET /api/publish/status` devolve o estado em memoria (`idle`, `running`, `done`, `error`) e o resumo do ultimo publish.
- A pagina `/monitor` tem o botao **Publicar no B2**, com polling do status e bloqueio visual enquanto o job roda.
- O job chama `oghma.publish.runner.run()` no processo da API e usa lock em memoria para impedir publish concorrente.

## Downloads reais no desktop (17/06/2026)

- A aba Downloads agora separa a fila em duas colunas verticais: **Em andamento** a esquerda e **Concluidos** a direita, cada uma com rolagem propria.
- O fluxo da fila chama `runDownload` de verdade: baixa o bundle publicado, gera os arquivos solicitados e salva em disco.
- Cada livro e salvo em `outputPath/titulo-sanitizado`; o botao **Abrir pasta** abre a pasta de saida configurada e cada item concluido tem um botao para abrir sua propria pasta.
- EPUB deixou de ser HTML intermediario: o desktop gera um `.epub` basico valido em ZIP/OPF/nav XHTML. PDF ainda usa HTML como base ate existir exportador dedicado.
- Se o item nao tiver `bundleKey` publicado ou houver erro de escrita, a fila marca o item como `error` e mostra a mensagem no card.
- Downloads concluidos agora entram desmarcados. A selecao e sempre uma acao explicita do usuario.
- O antigo botao **Exportar** virou **Converter**. Ele abre um modal para gerar formatos faltantes, marcar traducao e marcar audiobook; formatos ja existentes sao ignorados.
- Ao concluir um download, o livro ja passa a fazer parte da Biblioteca local automaticamente.
- A Biblioteca local deve refletir a pasta `outputPath`: o desktop lista as subpastas de `exports`, entao itens apagados do disco somem do app na proxima sincronizacao/entrada na tela.
- A capa da novel e salva junto do livro como `cover.*` quando `coverUrl` estiver disponivel, e a Biblioteca usa essa capa local.

## Kindle USB inicial (17/06/2026)

- O desktop agora tenta detectar Kindle conectado por USB procurando uma pasta `documents` em unidades/pontos de montagem comuns:
  - Windows: `D:\documents` ate `Z:\documents`.
  - macOS: `/Volumes/*/documents`.
  - Linux: `/media/$USER/*/documents`, `/run/media/$USER/*/documents` e `/mnt/*/documents`.
- O envio ao Kindle usa o comando `ebook-convert` do Calibre para converter EPUB em AZW3 quando o AZW3 ainda nao existe.
- Depois da conversao, o arquivo `.azw3` e copiado para a pasta `documents` do Kindle e o item ganha a label `AZW3` na fila.
- Se o Calibre/`ebook-convert` nao estiver no PATH, o app bloqueia o envio e mostra a razao.
- Nesta maquina, `ebook-convert` foi encontrado em `C:\Program Files\Calibre2\ebook-convert.exe`.
- Limite conhecido: Kindles que nao montam como armazenamento USB classico podem precisar de suporte MTP/libmtp em versao futura.
