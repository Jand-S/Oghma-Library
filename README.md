# Oghma Library

Sistema para **preservar novels fan-traduzidas**: um servidor coleta e arquiva o
acervo, publica um catálogo estático (catálogo + bundles + capas) no Backblaze B2
servido via Cloudflare, e um app desktop (Tauri + React) lê esse acervo, baixa,
converte (EPUB/PDF/TXT) e envia para o Kindle.

## Arquitetura

- **Desktop** (`apps/desktop`) — Tauri 2 + React 19 + TypeScript + Vite.
  Lê o acervo estático em `https://b2.jandson.me` (sem depender do servidor ligado).
- **Backend** (`backend`) — FastAPI + scraper + pacote `publish/` que gera o
  catálogo/bundles e sobe para o B2. Roda no servidor local (Docker Compose).
- **Distribuição** — B2 (S3-compatível) + Cloudflare (egress grátis). O desktop
  consome `index.json` → `catalog.json.gz` por site → bundles `.tar.gz` por novel.

## Rodando o desktop

```bash
cd apps/desktop
npm install
npm run tauri dev      # app completo (recompila o Rust)
npm test               # vitest
npx tsc --noEmit       # checagem de tipos
```

Opcional: **Calibre** (`ebook-convert`) no PATH para gerar/enviar AZW3.

## Rodando o backend

Ver `backend/HANDOFF.md`. Resumo: `docker compose up -d` (db + api) e
`docker compose run --rm crawler python -m oghma.publish --source central-novel`
para publicar no B2.

## Estrutura e manutenção

- Mapa dos diretórios: `docs/STRUCTURE.md`.
- Distribuição/armazenamento: `docs/DISTRIBUTION.md`, `docs/STORAGE_SETUP.md`.
- Kindle (detecção USB/MTP + WPD): `docs/KINDLE.md`.
- Convenção: arquivos pequenos e coesos (< ~400 linhas), 1 componente por arquivo,
  lógica em hooks. **Commits frequentes.**

## Documentação

A pasta `docs/` reúne arquitetura, contratos de API, conectores, plano de
refatoração e o resumo das sessões.
