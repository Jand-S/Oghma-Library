# Oghma Library

Sistema para **preservar novels fan-traduzidas**: um servidor coleta e arquiva o
acervo, publica um catálogo estático (catálogo + bundles + capas) no Backblaze B2
servido via Cloudflare, e um app desktop (Tauri + React) lê esse acervo, baixa,
converte (EPUB/TXT/AZW3) e envia para o Kindle.

## Arquitetura

- **Desktop** (`apps/desktop`) — Tauri 2 + React 19 + TypeScript + Vite.
  Lê o acervo estático em `https://b2.jandson.me` (sem depender do servidor ligado).
- **Backend** (`backend`) — crawlers, pacote `publish/` (catálogo, bundles e capas para o
  B2), rodízio de coleta e autoconnector. Roda numa VPS sob systemd
  (`backend/deploy/RUNTIME.md`).
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

O AZW3 sai do conversor embutido (Kindling); o **Calibre** (`ebook-convert`) no PATH é só reserva.

## Rodando o backend

Na VPS o backend roda num venv sob systemd: `oghma rodizio` coleta e publica, e o
`oghma-autoconnector` constrói conectores novos. Comandos, variáveis e unit em
`backend/deploy/RUNTIME.md`. Publicação manual de uma fonte:
`python -m oghma.publish --source central-novel`. O Docker Compose (`backend/HANDOFF.md`) é
o runtime antigo do servidor local.

## Estrutura e manutenção

- Mapa dos diretórios: `docs/STRUCTURE.md`.
- Arquitetura atual (VPS, arquivos publicados, app): `docs/ARCHITECTURE.md`.
- Roteiro e estado das fases: `docs/ROADMAP.md`.
- Armazenamento (B2 + Cloudflare): `docs/STORAGE_SETUP.md`.
- Runtime da VPS (rodízio, publicação, autoconnector): `backend/deploy/RUNTIME.md`.
- Kindle (detecção USB/MTP + WPD): `docs/KINDLE.md`.
- Convenção: arquivos pequenos e coesos (< ~400 linhas), 1 componente por arquivo,
  lógica em hooks. **Commits frequentes.**

## Documentação

A pasta `docs/` guarda o que vale hoje; planos, pilotos e relatos encerrados ficam em
`docs/archive/`.
