# Estrutura do projeto (pós-refatoração)

Objetivo: arquivos pequenos e coesos, fáceis de manter — e que não disparam o
truncamento de arquivos grandes do ambiente de sync.

## Desktop — `apps/desktop/src/`
- `main.tsx` — entry; escolhe o backend (estático B2 vs mock) e monta `<App/>`.
- `App.tsx` — orquestrador (estado + composição das telas).
- `app/` — hooks de lógica extraídos do App:
  - `useToast`, `useKindleDetection`, `useOnboardingSync`.
- `appUi.tsx` — **barrel**: só re-exporta as telas de `views/`.
- `views/` — uma feature por arquivo (todas pequenas):
  - `shell` (Splash/Titlebar/Sidebar), `discover`, `downloads`, `sources`,
    `library`, `settings`, `onboarding`, `kindle`.
- `constants/ui.ts` — `views`, `pageTitle`, `onboardingSteps`, `tags`, etc.
- `core/types.ts` — tipos de domínio.
- `core/appConfig.ts` — config + persistência (localStorage).
- `core/windowControls.ts` — controles da janela (Tauri).
- `services/` — camada de dados/integração:
  - `backendClient.ts` (interface), `staticBackend.ts` (lê do B2/CDN),
    `mockBackend.ts` (dev), `bundle.ts` (baixa/extrai .tar.gz),
    `downloadManager.ts` (orquestra download→formatos→salvar),
    `localFiles.ts` (ponte Tauri: fs, abrir pasta, Kindle).
- `styles/` — CSS por área: `tokens`, `base`, `layout`, `components`, `views`,
  `responsive`, importados por `styles/index.css`.
- `test/` — setup do Vitest e todos os `*.test.*`.

## Desktop — Rust (`apps/desktop/src-tauri/src/`)
- `lib.rs` — comandos Tauri (fs, biblioteca, Kindle: `detect_kindle`/`send_to_kindle`)
  + `run()`.
- `kindle_mtp.rs` — envio MTP via WPD (Windows).

## Backend — `backend/`
- `src/oghma/` — FastAPI + scraper + `publish/` (gera catálogo/bundles pro B2).
- Deploy via Docker Compose; ver `backend/HANDOFF.md` e `docs/`.

## Convenções
- 1 componente por arquivo; lógica em hooks `useX`.
- Tipos/constantes sem dependência de UI (evita ciclos).
- Manter arquivos abaixo de ~400 linhas.
- **Commits frequentes** (a rede de segurança contra corrupção do mount).
