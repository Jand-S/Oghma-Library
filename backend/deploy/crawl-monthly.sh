#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${OGHMA_PROJECT_DIR:-/home/codex/oghma}"
LOG_DIR="${OGHMA_CRAWL_LOG_DIR:-/srv/oghma/logs}"
LOCK_FILE="${OGHMA_CRAWL_LOCK_FILE:-/srv/oghma/crawl-central-novel.lock}"
SOURCE="${OGHMA_CRAWL_SOURCE:-central-novel}"

mkdir -p "$LOG_DIR"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "==== $(date -Is) crawl skipped source=$SOURCE reason=already-running ====" \
    | tee -a "$LOG_DIR/crawl-$SOURCE.log"
  exit 0
fi

{
  echo "==== $(date -Is) crawl start source=$SOURCE ===="
  cd "$PROJECT_DIR"
  docker compose run --rm crawler oghma crawl --source "$SOURCE"
  echo "==== $(date -Is) crawl done source=$SOURCE ===="
} 2>&1 | tee -a "$LOG_DIR/crawl-$SOURCE.log"
