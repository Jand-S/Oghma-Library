# Oghma Library Desktop

Aplicativo desktop do Oghma Library feito com Tauri, React e TypeScript.

## Desenvolvimento

```bash
npm install
npm run dev
npm run tauri:dev
```

`npm run dev` abre a UI via Vite. `npm run tauri:dev` abre a janela desktop do Tauri.

## Build

```bash
npm run build
npm run tauri -- build --bundles nsis
```

O instalador Windows fica em:

```text
src-tauri/target/release/bundle/nsis/
```

## Release

Para publicar uma versao no GitHub:

1. Atualize `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` e `src-tauri/tauri.conf.json`.
2. Gere o instalador com `npm run tauri -- build --bundles nsis`.
3. Crie uma tag, por exemplo `v1.0.0`.
4. Crie uma GitHub Release usando essa tag e anexe o arquivo `Oghma Library_1.0.0_x64-setup.exe`.

