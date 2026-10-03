# Estrutura do projeto

Mapa dos diretórios como estão hoje (outubro de 2026). Para o desenho do sistema, veja
`ARCHITECTURE.md`; para o que vem a seguir, `ROADMAP.md`.

## Raiz

| Pasta | O que é |
|---|---|
| `apps/desktop` | App desktop: Tauri 2 + React 19 + TypeScript + Vite |
| `backend` | Coleta (crawlers), publicação no B2, rodízio e autoconnector (Python) |
| `docs` | Documentação atual; `docs/archive/` guarda planos e pilotos já encerrados |
| `landing` | Página pública do projeto |
| `vendor` | Dependências vendorizadas (ex.: `kindling-mobi`, conversor EPUB → AZW3) |

## Desktop — `apps/desktop/src/`

- `main.tsx` — entrada: escolhe o backend (estático no B2 ou mock), aplica a config e
  monta `<App/>`. Recarrega a janela quando a URL do servidor muda.
- `App.tsx` — compõe o shell e as telas.
- `app/` — estado transversal em hooks: `useBootstrapState`, `useNovelSearch`,
  `useLocalLibrary`, `useDownloadQueue`, `useConversionManager`, `useKindleDetection`,
  `NavigationContext` e `viewRegistry` (telas registradas na navegação).
- `features/<tela>/` — uma pasta por tela, cada uma com `XView.tsx`, `useXController.ts`,
  componentes e CSS próprios:
  - `home` — Início: continuar lendo, capítulos novos, para você, recém-chegadas.
  - `discover` — Buscar: grade, filtros, filtro inteligente (`SmartFilterPanel`),
    detalhe com edições e parecidas.
  - `library`, `downloads`, `sources`, `kindle`, `settings`, `onboarding`, `translation`.
- `services/` — dados e integração, sem React:
  - `backendClient.ts` (interface), `staticBackend.ts` (lê `index.json` e os catálogos do
    B2, confere SHA-256), `mockBackend.ts` (dev e testes).
  - `catalogIndex.ts` — índice local de todas as fontes: busca sem acento por título,
    autor, sinopse e tags; agrupamento de edições; parecidas; ordenações.
  - `smartFilter.ts` — filtro inteligente: pedido em linguagem natural → intenção →
    filtros e ranking sobre o `catalogIndex` (ChatGPT quando logado; regras locais sem login).
  - `bundle.ts` + `sha256.ts` — baixa e extrai o `.tar.gz` da novel conferindo o hash.
  - `downloadQueue.ts`, `jobRunner.ts`, `downloadManager.ts`, `exportStaging.ts` — fila,
    execução e montagem dos formatos (EPUB e TXT; o AZW3 sai do EPUB, no Rust).
  - `localFiles.ts` — ponte Tauri para arquivos, pasta de saída e Kindle.
  - `translationClient.ts`, `sourceRequests.ts`.
- `core/` — tipos de domínio, config (`appConfig`, `defaults`), `tagFilters` (taxonomia
  do app; os rótulos acompanham `backend/src/oghma/taxonomy/tags.py`).
- `shell/` — moldura do app (sidebar, cabeçalho, painel inferior).
- `ui/` — componentes base do design system (Button, Chip, Cover, Badge…).
- `strings/` — textos da interface por tela, em pt-BR.
- `styles/` — tokens e CSS global. `dev/Gallery.tsx` mostra os componentes.
- `test/` — Vitest (`*.test.ts[x]`), com `renderApp.tsx` para testes de tela inteira.

## Desktop — Rust (`apps/desktop/src-tauri/src/`)

- `lib.rs` — registra os comandos Tauri e o estado (`ExportRoot`).
- `export_root.rs` — **a pasta de saída é guardada no Rust.** Todo comando que lê, grava,
  abre ou apaga arquivos confere se o caminho está dentro dela. Apagar exige o marcador
  `.oghma-book.json`.
- `files.rs` — biblioteca local, capas, abrir pasta, faixa de capítulos dos livros parciais.
- `staging.rs` — exportação atômica (pasta temporária → troca).
- `library_meta.rs` — favoritos, status de leitura, ocultos.
- `kindle.rs`, `kindle_mtp.rs` (Windows/WPD), `kindle_mtp_mac.rs` (macOS/MTP) — ver `KINDLE.md`.
- `cloud.rs`, `paths.rs` — iCloud e caminhos.
- `translation/` — tradução EN → pt-BR pelo plano ChatGPT do usuário (Sign in with
  ChatGPT). Os tokens ficam só no Rust; o filtro inteligente usa o mesmo transporte
  (`smart_filter_ask`).

## Backend — `backend/`

- `src/oghma/scraper/` — `orchestrator.py` (coleta incremental, erros transitórios não
  abortam a novel), `fetcher.py`, `connectors/` (um arquivo por site; helpers comuns em
  `connectors/_common.py`).
- `src/oghma/publish/` — gera o catálogo JSON por fonte, os bundles e o `index.json` e sobe
  para o B2 (`runner.py`, `catalog.py`, `bundles.py`, `covers.py`, `source_meta.py`,
  `uploader.py`, `prune.py`).
- `src/oghma/rodizio.py` — serviço principal na VPS: coleta, publica e libera espaço, fonte
  por fonte.
- `src/oghma/autoconnector/` + `backend/autoconnector/` — fábrica de conectores com agentes
  de IA: rodam como `oghma-agent`, sem segredos, e o deploy espera aprovação no brain.
- `src/oghma/taxonomy/` — taxonomia de tags (fonte da verdade).
- `src/oghma/api/` — API FastAPI legada (só o runtime Docker antigo usa; sai depois da
  migração completa para a VPS).
- `deploy/` — systemd, scripts de operação, `RUNTIME.md` (contrato do runtime na VPS),
  `setup-agent-user.sh`.

## Convenções

- Um componente por arquivo; lógica em hooks `useX`; serviços sem React.
- Arquivos abaixo de ~400 linhas.
- Textos de interface em `strings/`, em pt-BR.
- Commits pequenos, mensagem em inglês no imperativo.
