#!/usr/bin/env bash
# Roda NO SERVIDOR (codex). Sobe Postgres + API com Docker Compose, cria schema e seeds.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v docker >/dev/null 2>&1; then
  echo "ERRO: Docker nao encontrado. Instale o Docker + plugin compose antes." >&2
  exit 1
fi
DC="docker compose"; $DC version >/dev/null 2>&1 || DC="docker-compose"

[ -f .env ] || cp .env.example .env
# cria os diretorios de dados no host (lendo .env de forma segura)
STORAGE_HOST=$(grep -E '^OGHMA_STORAGE_HOST=' .env | tail -1 | cut -d= -f2-)
mkdir -p "${STORAGE_HOST:-./storage}/logs"
PG_HOST=$(grep -E '^OGHMA_PG_HOST=' .env | tail -1 | cut -d= -f2-)
case "$PG_HOST" in /*) mkdir -p "$PG_HOST";; esac

echo ">> build"; $DC build
echo ">> up db"; $DC up -d db
echo ">> aguardando Postgres..."; sleep 8
echo ">> init-db"; $DC run --rm crawler oghma init-db
echo ">> seed-sources"; $DC run --rm crawler oghma seed-sources
echo ">> up api"; $DC up -d api

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
API_HOST_PORT=$(grep -E '^OGHMA_API_HOST_PORT=' .env | tail -1 | cut -d= -f2-)
echo ""
echo "OK. API: http://${IP:-localhost}:${API_HOST_PORT:-8010}  (docs em /docs, health em /health)"
echo "Calibracao dos seletores:"
echo "  $DC run --rm crawler oghma probe https://centralnovel.com/series/"
echo "Primeiro crawl pequeno:"
echo "  $DC run --rm crawler oghma crawl --source central-novel --limit 3 --chapter-limit 5"
