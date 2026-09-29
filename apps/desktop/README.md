# Oghma Library Desktop

Aplicativo desktop do Oghma Library, feito com Tauri 2, React 19, TypeScript, Vite e CSS puro em
camadas. Ele baixa light novels em EPUB/AZW3, mantém uma biblioteca local e envia livros ao Kindle.

## Pré-requisitos

- **Node.js** 22 ou mais novo (exigência do Vite 8). O Node 26 também funciona: os testes rodam **sem flags**, porque
  `src/test/setup.ts` troca o `localStorage` nativo do Node pelo do jsdom. Não é preciso
  `NODE_OPTIONS=--no-experimental-webstorage`.
- **Rust** (via [rustup](https://rustup.rs)) para rodar o app nativo e os testes Rust. Também são
  necessárias as dependências do Tauri de cada sistema (Xcode Command Line Tools no macOS, WebView2 e
  MSVC no Windows, `webkit2gtk` no Linux). Veja <https://tauri.app/start/prerequisites/>.

  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  export PATH="$HOME/.cargo/bin:$PATH"
  ```

## Desenvolvimento

```bash
npm ci
npm run dev          # UI no navegador (Vite) em http://127.0.0.1:5173
npm run tauri:dev    # janela nativa do Tauri (precisa de Rust)
```

- No navegador, o app roda sem o runtime Tauri. Os recursos nativos (pastas, AZW3, Kindle) usam
  fallbacks, e a janela não tem controles nativos.
- **Galeria de componentes:** com `npm run dev`, abra `http://127.0.0.1:5173/?gallery`. Ela só
  existe em dev e não entra no build.

## Verificações

```bash
npm test                 # Vitest (jsdom), cerca de 4 s
npx tsc --noEmit         # tipos
npm run lint:css         # regras do design system (tokens, @layer, sem !important)
npm run tauri:check      # cargo check do src-tauri
cargo test --manifest-path src-tauri/Cargo.toml   # testes Rust (staging, biblioteca, Kindle)
```

- `npm run lint:css` falha quando encontra cor ou px crus, `!important`, regra fora de `@layer` ou
  seletor duplicado, em qualquer arquivo de `src/` (não há mais CSS legado com exceção).
- As regras e o catálogo de componentes estão em [`docs/DESIGN_SYSTEM.md`](../../docs/DESIGN_SYSTEM.md).
  A fila de download e a exportação atômica estão descritas em
  [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Estrutura

```text
src/
  styles/        tokens.css e as camadas reset/base/layout/utilities
  ui/            primitivas (.o-*), cada uma com seu .css
  shell/         AppShell, Sidebar, TitleBar, PageHeader, BottomPanel, SplashScreen
  app/           NavigationContext, viewRegistry (layout e slot de cabeçalho por tela), hooks de app
  features/      telas por área: view, controller, cabeçalho e CSS
  services/      downloadQueue, jobRunner, exportStaging, downloadManager, bundle, localFiles
  strings/       textos pt-BR usados pelas telas e pelos testes
  dev/           Gallery (só dev)
src-tauri/       Rust: staging.rs, files.rs, kindle.rs, library_meta.rs
bench/           benchmark e comparação visual v1 × redesign (Playwright)
```

## Benchmark

A pasta [`bench/`](bench/README.md) compara o v1.0.0 com a UI nova usando Playwright, fixtures
determinísticas e um Tauri falso. Ela tem dependências próprias; veja o README dela para instalar e rodar.

## Build

```bash
npm run build                               # tsc + vite build
npm run tauri -- build --bundles nsis       # instalador Windows
```

O instalador Windows fica em:

```text
src-tauri/target/release/bundle/nsis/
```

A configuração da janela está em `src-tauri/tauri.conf.json`, e o override de macOS em
`src-tauri/tauri.macos.conf.json`. O override usa semáforos nativos e `titleBarStyle: "Overlay"`.
Como `app.windows` é um array e o merge substitui o array inteiro, **toda mudança na janela precisa
ser feita nos dois arquivos**.

## Release

Para publicar uma versão no GitHub:

1. Atualize `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Gere o instalador com `npm run tauri -- build --bundles nsis`.
3. Crie uma tag, por exemplo `v1.0.0`.
4. Crie uma GitHub Release usando essa tag e anexe o arquivo `Oghma Library_1.0.0_x64-setup.exe`.
