# Reorganização da pasta `apps/desktop/src` (para o codex executar)

Objetivo: agrupar os testes, limpar a raiz de `src` e remover lixo. É **só mover
arquivos + corrigir imports** — nenhuma mudança de comportamento. Fazer no servidor
(filesystem estável + git funcionando).

## Layout alvo
```
src/
  main.tsx
  App.tsx
  appUi.tsx              (barrel das views)
  app/                   hooks (useToast, useKindleDetection, useOnboardingSync)
  views/                 telas
  services/              backendClient, staticBackend, bundle, downloadManager,
                         localFiles, mockBackend   (mockBackend movido pra cá)
  core/        (NOVA)    appConfig.ts, types.ts, windowControls.ts
  constants/             ui.ts
  styles/
  test/                  setup.ts + TODOS os *.test.*
```

## 1. Remover lixo (não rastreado / temporário)
```bash
cd apps/desktop/src
rm -f split_appui.py refactor_app1.py __rmtest.tmp .fuse_hidden*
```

## 2. Mover arquivos (preserva histórico)
```bash
cd apps/desktop
mkdir -p src/core
git mv src/appConfig.ts       src/core/appConfig.ts
git mv src/types.ts           src/core/types.ts
git mv src/windowControls.ts  src/core/windowControls.ts
git mv src/mockBackend.ts     src/services/mockBackend.ts
git mv src/App.test.tsx               src/test/App.test.tsx
git mv src/appConfig.test.ts          src/test/appConfig.test.ts
git mv src/mockBackend.test.ts        src/test/mockBackend.test.ts
git mv src/services/bundle.test.ts          src/test/bundle.test.ts
git mv src/services/downloadManager.test.ts src/test/downloadManager.test.ts
git mv src/services/staticBackend.test.ts   src/test/staticBackend.test.ts
```

## 3. Corrigir imports
`git mv` **não** atualiza imports. O caminho mais seguro: rodar `npx tsc --noEmit`
e corrigir cada import que ele apontar. As mudanças seguem este padrão (pelo local
do arquivo que importa):

**Arquivos na raiz de `src` (`App.tsx`, `main.tsx`):**
- `"./appConfig"`      → `"./core/appConfig"`
- `"./types"`          → `"./core/types"`
- `"./windowControls"` → `"./core/windowControls"`
- `"./mockBackend"`    → `"./services/mockBackend"`

**Arquivos em subpasta de 1 nível (`views/`, `app/`, `constants/`, `services/`):**
- `"../appConfig"`      → `"../core/appConfig"`
- `"../types"`          → `"../core/types"`
- `"../windowControls"` → `"../core/windowControls"`
- `"../mockBackend"`    → `"../services/mockBackend"`

**`services/mockBackend.ts` (agora dentro de `services/`) — ajustar os imports dele:**
- `"./types"`               → `"../core/types"`
- `"./appConfig"`           → `"../core/appConfig"`
- `"./services/backendClient"` → `"./backendClient"`

**Arquivos de teste (agora em `src/test/`):**
- `"./App"`        → `"../App"`
- `"./appUi"`      → `"../appUi"`
- `"./appConfig"`  → `"../core/appConfig"`
- `"./mockBackend"`→ `"../services/mockBackend"`
- `"./services/backendClient"` → `"../services/backendClient"`
- testes que estavam em `services/` e importavam vizinhos:
  `"./bundle"` → `"../services/bundle"`, `"./downloadManager"` → `"../services/downloadManager"`,
  `"./staticBackend"` → `"../services/staticBackend"`, e `"../types"` → `"../core/types"`.

> Atenção: dentro de `core/`, `appConfig.ts` importa `"./types"` — **mantém** `"./types"`
> (são vizinhos na mesma pasta). Não trocar esse.

Dica: dá pra usar um editor com "move file/update imports" ou `ts-morph`, mas o
loop `tsc --noEmit` → corrigir é suficiente e seguro.

## 4. Validar
```bash
cd apps/desktop
npx tsc --noEmit      # zero erros
npm test              # vitest (App + services)
```
Confirme que `vite.config`/vitest ainda acha os testes (o include padrão
`**/*.{test,spec}.*` cobre `src/test/`). Se houver `test/setup.ts` referenciado no
config, ele continua em `src/test/`.

## 5. Commit
```bash
git add -A
git commit -m "refactor: reorganiza src (core/, services/mockBackend, test/) + remove lixo"
```

## Resultado
Raiz de `src/` fica só com `main.tsx`, `App.tsx`, `appUi.tsx` + as pastas. Testes
todos em `src/test/`. Sem arquivos temporários.

---

Status: executado pelo codex em 17/06/2026. Este arquivo fica como registro do roteiro usado.
