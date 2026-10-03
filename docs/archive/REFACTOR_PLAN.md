# Plano de Refatoração — Clean Code & Modularização (desktop)

## Por que (objetivo duplo)
1. **Manutenção:** arquivos enormes são difíceis de evoluir e revisar.
2. **Estabilidade:** a ponte de arquivos do ambiente trunca **arquivos grandes** na escrita.
   Módulos pequenos (~50–150 linhas) reduzem drasticamente o risco de corrupção.

Cada fase é pequena, isolada e **commitada** ao terminar (porto seguro). Validação a cada fase:
`npm run -s tsc` (ou `npx tsc --noEmit`), `npm test` e, no fim, `npm run tauri dev`.

## Diagnóstico atual (linhas)
| Arquivo | Linhas | Situação |
|---|---|---|
| `src/styles.css` | 2188 | monólito — dividir por área |
| `src/appUi.tsx` | 1478 | 16 componentes num arquivo — 1 por arquivo |
| `src/App.tsx` | 623 | 53 hooks + ~25 handlers — extrair hooks |
| `src/mockBackend.ts` | 497 | dados + lógica juntos — separar fixtures |
| `src/services/*` | <310 | OK (já modular) |
| `src-tauri/src/lib.rs` | 346 | dividir em módulos de comandos |
| `src-tauri/src/kindle_mtp.rs` | 200 | OK (já separado) |

## Princípios
- **1 componente por arquivo**; nome do arquivo = nome do componente.
- **Lógica em hooks** (`useX.ts`), UI em componentes "burros".
- **Tipos centralizados** em `types/` (por domínio), sem regra de negócio.
- **Constantes/config** fora dos componentes (`constants/`).
- **CSS por área**, importado por um índice.
- **Barrels** (`index.ts`) só onde reduzem churn de import; evitar barrels gigantes.
- Sem mudança de comportamento — é refatoração pura (mesmos testes passando).

## Estrutura-alvo
```
src/
  main.tsx
  App.tsx                      # só composição (pequeno)
  app/
    useBootstrap.ts            # bootstrap + carga inicial + detecção Kindle
    useToast.ts
  components/
    SplashScreen.tsx
    Titlebar.tsx
    Sidebar.tsx
    common/                    # NovelCard, SkeletonGrid, Badge, ProgressBar...
  features/
    discover/  DiscoverView.tsx FiltersPanel.tsx SelectionConfigurator.tsx useDiscover.ts
    downloads/ DownloadsView.tsx useDownloadQueue.ts
    sources/   SourcesView.tsx useSources.ts
    library/   LibraryView.tsx useLibrary.ts
    settings/  SettingsView.tsx
    onboarding/OnboardingWizard.tsx useOnboarding.ts
    kindle/    KindleTransferModal.tsx ConversionModal.tsx useKindle.ts
  services/                    # (já existe) backendClient, staticBackend, mockBackend, bundle, downloadManager, localFiles
  constants/                   # pageTitle, onboardingSteps, indexModeOptions, tags...
  types/                       # domain types (novel, queue, source, kindle, config)
  styles/
    index.css                  # @import dos demais
    tokens.css                 # variáveis (cores, radius, sombras)
    base.css                   # reset, scrollbars, tipografia
    layout.css                 # app-frame, sidebar, workspace, titlebar
    components/*.css
    views/*.css
```

## Mapa de migração

### `appUi.tsx` → componentes (1 por arquivo)
SplashScreen, Titlebar, Sidebar → `components/`.
FiltersPanel, SelectionConfigurator, NovelCard, SkeletonGrid, DiscoverView → `features/discover/`.
DownloadsView → `features/downloads/`. SourcesView → `features/sources/`.
LibraryView → `features/library/`. SettingsView → `features/settings/`.
OnboardingWizard → `features/onboarding/`. KindleTransferModal, ConversionModal → `features/kindle/`.
`pageTitle`, `onboardingSteps`, `indexModeOptions`, `translationEngineOptions`, `tags`, `views`, `statusLabel` → `constants/`.
Transição: manter `appUi.tsx` como **barrel** re-exportando dos novos arquivos (mantém `App.tsx` intacto), e remover o barrel ao final quando os imports forem atualizados.

### `App.tsx` → hooks
- `useBootstrap` — bootstrap + getKindleStatus + carga inicial.
- `useDiscover` — filtros, busca, seleção, addToQueue.
- `useDownloadQueue` — fila, pausar, selecionar, exportar, cancelar, abrir pasta.
- `useKindle` — modal/transfer/conversão (inclui o "fecha modal após envio").
- `useOnboarding` — passos, validar servidor, sync inicial.
- `useLibrary` — biblioteca local.
`App.tsx` fica só com a composição (providers/hooks + layout + roteamento de view).

### `mockBackend.ts` → `services/mock/`
`fixtures.ts` (sources/novels/queue/library/endpoints) + `mockBackend.ts` (implementa `BackendClient`).

### `styles.css` → `styles/*`
Quebrar por: tokens, base (inclui scrollbars), layout, e um `.css` por área/feature. `main.tsx` importa `styles/index.css`.

### `lib.rs` → módulos Rust
- `commands/fs.rs` — save_export_file, open_local_path, list_export_library.
- `commands/kindle.rs` — detect_kindle, send_to_kindle, KindleStatus, helpers (kindle_usb_present, find_kindle_documents_dir...).
- `kindle_mtp.rs` — já existe (WPD).
- `lib.rs` — só `run()` + `mod`/`invoke_handler`.

## Fases (pequenas, commit a cada uma)
1. **CSS — tokens + base + layout** (extrair de `styles.css`, importar no `main.tsx`). Commit.
2. **CSS — components + views** (resto). `styles.css` esvazia. Commit.
3. **constants/ + types/** (mover dados puros). Commit.
4. **components/** (Splash, Titlebar, Sidebar) + barrel. Commit.
5. **features/discover/** (+ hook useDiscover). Commit.
6. **features/downloads/ + sources/ + library/ + settings/**. Commit.
7. **features/onboarding/ + kindle/** (inclui fecha-modal). Commit.
8. **App.tsx → hooks** (useBootstrap/useDiscover/useDownloadQueue/useKindle/useOnboarding). Commit.
9. **Remover barrel `appUi.tsx`**, atualizar imports de `App.tsx`. Commit.
10. **Rust:** dividir `lib.rs` em `commands/*`. Commit.
11. **Limpeza final** + rodar tudo (tsc, vitest, tauri dev). Commit.

## Workflow à prova de corrupção
- Cada fase cria **arquivos novos pequenos** (baixo risco) e só **encolhe** o monólito ao final da fase.
- A escrita que **remove** código do arquivo grande (appUi/App/styles) é o ponto de risco:
  fazer **commit antes**, e se truncar, `git checkout HEAD -- <arquivo>` e reaplicar.
- Arquivos novos: se possível, eu entrego como **texto** para aplicar no editor estável, ou escrevo
  e **verifico na hora** (wc/tail/tsc) antes de seguir.
- **Commit ao fim de cada fase.** Nunca acumular duas fases sem commit.

## Validação por fase
- `npx tsc --noEmit` (zero erros).
- `npm test` (vitest — App + services).
- Ao final: `npm run tauri dev` (compila Rust + roda app).
- Critério: **comportamento idêntico** ao de antes (refatoração não muda features).

## Riscos
- Imports circulares ao separar (mitigar com `types/` e `constants/` sem dependências de UI).
- Ordem do CSS importa (cascata): manter ordem tokens → base → layout → components → views.
- Refatorar `App.tsx` (hooks) é o passo mais delicado: fazer por último e em sub-passos.
