#!/usr/bin/env bash
set -u -o pipefail

DEFAULT_PROJECT_DIR="/home/codex/oghma"
DEFAULT_LOG_DIR="/srv/oghma/logs"
DEFAULT_LOCK_DIR="/srv/oghma/locks"
DEFAULT_SUMMARY_DIR="/srv/oghma/reports"
DEFAULT_SOURCES="central-novel novel-mania house-saikai sky-demon-order golden-novel mahou-reader rolia-scan"

PROJECT_DIR="${OGHMA_PROJECT_DIR:-$DEFAULT_PROJECT_DIR}"
LOG_DIR="${OGHMA_CRAWL_LOG_DIR:-$DEFAULT_LOG_DIR}"
LOCK_DIR="${OGHMA_CRAWL_LOCK_DIR:-$DEFAULT_LOCK_DIR}"
SUMMARY_DIR="${OGHMA_CRAWL_SUMMARY_DIR:-$DEFAULT_SUMMARY_DIR}"
SOURCES="${OGHMA_DAILY_SOURCES:-$DEFAULT_SOURCES}"
PUBLISH_AFTER_CRAWL="${OGHMA_PUBLISH_AFTER_CRAWL:-1}"
COMMAND_ATTEMPTS="${OGHMA_DAILY_COMMAND_ATTEMPTS:-2}"
BOOT_WAIT_SECONDS="${OGHMA_BOOT_WAIT_SECONDS:-900}"
CRAWL_PARALLELISM="${OGHMA_DAILY_CRAWL_PARALLELISM:-1}"
SHUTDOWN_WHEN_DONE=0

for arg in "$@"; do
  case "$arg" in
    --shutdown-when-done) SHUTDOWN_WHEN_DONE=1 ;;
  esac
done

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${PROJECT_DIR}/.env"
  set +a
fi
if [[ -f "/srv/oghma/.env.daily-crawl" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "/srv/oghma/.env.daily-crawl"
  set +a
fi

PROJECT_DIR="${OGHMA_PROJECT_DIR:-$PROJECT_DIR}"
LOG_DIR="${OGHMA_CRAWL_LOG_DIR:-$LOG_DIR}"
LOCK_DIR="${OGHMA_CRAWL_LOCK_DIR:-$LOCK_DIR}"
SUMMARY_DIR="${OGHMA_CRAWL_SUMMARY_DIR:-$SUMMARY_DIR}"
SOURCES="${OGHMA_DAILY_SOURCES:-$SOURCES}"
PUBLISH_AFTER_CRAWL="${OGHMA_PUBLISH_AFTER_CRAWL:-$PUBLISH_AFTER_CRAWL}"
COMMAND_ATTEMPTS="${OGHMA_DAILY_COMMAND_ATTEMPTS:-$COMMAND_ATTEMPTS}"
BOOT_WAIT_SECONDS="${OGHMA_BOOT_WAIT_SECONDS:-$BOOT_WAIT_SECONDS}"
CRAWL_PARALLELISM="${OGHMA_DAILY_CRAWL_PARALLELISM:-$CRAWL_PARALLELISM}"
GLOBAL_LOCK="${LOCK_DIR}/crawl-daily-completed.lock"

mkdir -p "$LOG_DIR" "$LOCK_DIR" "$SUMMARY_DIR"

RUN_ID="$(date +%Y%m%d-%H%M%S)"
MAIN_LOG="${LOG_DIR}/crawl-daily-completed-${RUN_ID}.log"
SUMMARY_FILE="${SUMMARY_DIR}/crawl-daily-completed-${RUN_ID}.txt"
POSTGRES_USER="${POSTGRES_USER:-oghma}"
POSTGRES_DB="${POSTGRES_DB:-oghma}"

exec 9>"$GLOBAL_LOCK"
if ! flock -n 9; then
  echo "daily-crawl skipped: already running" | tee -a "$MAIN_LOG"
  exit 0
fi

cd "$PROJECT_DIR" || exit 2

duration() {
  local seconds="$1"
  printf "%02dh %02dm %02ds" "$((seconds / 3600))" "$(((seconds % 3600) / 60))" "$((seconds % 60))"
}

wait_for_stack() {
  local start_ts now elapsed db_health api_status
  start_ts="$(date +%s)"

  echo "==== $(date -Is) waiting for Docker/Postgres/API readiness ====" | tee -a "$MAIN_LOG"
  docker compose up -d db api 2>&1 | tee -a "$MAIN_LOG" || true

  while true; do
    now="$(date +%s)"
    elapsed="$((now - start_ts))"
    db_health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' oghma-db-1 2>/dev/null || echo missing)"
    api_status="starting"

    if [[ "$db_health" == "healthy" ]] && docker compose exec -T db pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then
      if curl -fsS --max-time 5 http://127.0.0.1:8010/health >/dev/null 2>&1; then
        api_status="ok"
      fi
      echo "==== $(date -Is) stack ready db=${db_health} api=${api_status} waited=${elapsed}s ====" | tee -a "$MAIN_LOG"
      return 0
    fi

    if (( elapsed >= BOOT_WAIT_SECONDS )); then
      echo "==== $(date -Is) stack not ready after ${elapsed}s db=${db_health} ====" | tee -a "$MAIN_LOG"
      docker compose ps 2>&1 | tee -a "$MAIN_LOG" || true
      return 1
    fi

    if (( elapsed % 30 < 5 )); then
      echo "==== $(date -Is) still waiting for stack db=${db_health} waited=${elapsed}s ====" | tee -a "$MAIN_LOG"
    fi
    sleep 5
  done
}

source_label() {
  case "$1" in
    central-novel) echo "Central Novel" ;;
    novel-mania) echo "Novel Mania" ;;
    house-saikai) echo "House Saikai" ;;
    sky-demon-order) echo "Sky Demon" ;;
    golden-novel) echo "Golden Novel" ;;
    mahou-reader) echo "Mahou Reader" ;;
    rolia-scan) echo "RoliaScan" ;;
    *) echo "$1" ;;
  esac
}

exit_label() {
  case "$1" in
    0) echo "OK" ;;
    skipped) echo "PULADO" ;;
    *) echo "ERRO:$1" ;;
  esac
}

run_command_with_retries() {
  local label="$1"
  shift
  local status=0
  local attempt=1

  while true; do
    if (( attempt > 1 )); then
      echo "==== $(date -Is) retry ${label} attempt=${attempt}/${COMMAND_ATTEMPTS} ====" | tee -a "$MAIN_LOG"
      sleep 5
    fi

    "$@"
    status="${PIPESTATUS[0]}"
    if [[ "$status" == "0" || "$attempt" -ge "$COMMAND_ATTEMPTS" ]]; then
      return "$status"
    fi

    echo "==== $(date -Is) ${label} failed exit=${status}; will retry ====" | tee -a "$MAIN_LOG"
    attempt="$((attempt + 1))"
  done
}

count_novels() {
  local source="$1"
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
    "select count(*) from novel where source_id='${source}';" 2>/dev/null | tr -d '[:space:]'
}

count_chapters() {
  local source="$1"
  docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc \
    "select count(*) from chapter c join novel n on n.id = c.novel_id where n.source_id='${source}';" 2>/dev/null | tr -d '[:space:]'
}

run_source() {
  local source="$1"
  local lock_file="${LOCK_DIR}/crawl-${source}.lock"
  local source_log="${LOG_DIR}/crawl-${source}.log"

  exec {source_fd}>"$lock_file"
  if ! flock -n "$source_fd"; then
    echo "${source}|skipped|0|0|0|0|0|0|0" > "$TMP_RESULTS_DIR/$source"
    echo "==== $(date -Is) source=${source} skipped reason=already-running ====" | tee -a "$MAIN_LOG" "$source_log"
    return 0
  fi

  local start_ts end_ts elapsed status before_novels after_novels before_chapters after_chapters
  start_ts="$(date +%s)"
  before_novels="$(count_novels "$source")"
  before_chapters="$(count_chapters "$source")"
  before_novels="${before_novels:-0}"
  before_chapters="${before_chapters:-0}"

  local cmd=(docker compose run --rm --no-deps crawler oghma crawl --source "$source")
  if [[ -n "${OGHMA_CRAWL_LIMIT:-}" ]]; then
    cmd+=(--limit "$OGHMA_CRAWL_LIMIT")
  fi
  if [[ -n "${OGHMA_CHAPTER_LIMIT:-}" ]]; then
    cmd+=(--chapter-limit "$OGHMA_CHAPTER_LIMIT")
  fi
  if [[ "${OGHMA_CRAWL_REFRESH:-0}" == "1" ]]; then
    cmd+=(--refresh)
  fi

  {
    echo "==== $(date -Is) crawl start source=${source} ===="
    printf 'cmd:'
    printf ' %q' "${cmd[@]}"
    printf '\n'
  } | tee -a "$MAIN_LOG" "$source_log"

  run_command_with_retries "crawl source=${source}" "${cmd[@]}" 2>&1 | tee -a "$MAIN_LOG" "$source_log"
  status="${PIPESTATUS[0]}"

  after_novels="$(count_novels "$source")"
  after_chapters="$(count_chapters "$source")"
  after_novels="${after_novels:-$before_novels}"
  after_chapters="${after_chapters:-$before_chapters}"
  end_ts="$(date +%s)"
  elapsed="$((end_ts - start_ts))"

  echo "==== $(date -Is) crawl finish source=${source} exit=${status} ====" | tee -a "$MAIN_LOG" "$source_log"
  echo "${source}|${status}|${before_novels}|${after_novels}|$((after_novels - before_novels))|${before_chapters}|${after_chapters}|$((after_chapters - before_chapters))|${elapsed}" > "$TMP_RESULTS_DIR/$source"
  return 0
}

run_crawlers() {
  local parallelism="$CRAWL_PARALLELISM"
  if ! [[ "$parallelism" =~ ^[0-9]+$ ]] || (( parallelism < 1 )); then
    parallelism=1
  fi

  echo "==== $(date -Is) crawl parallelism=${parallelism} ====" | tee -a "$MAIN_LOG"
  local active=0
  local source
  for source in $SOURCES; do
    run_source "$source" &
    active="$((active + 1))"
    if (( active >= parallelism )); then
      wait -n || true
      active="$((active - 1))"
    fi
  done

  while (( active > 0 )); do
    wait -n || true
    active="$((active - 1))"
  done
}

publish_source() {
  local source="$1"
  local source_log="${LOG_DIR}/publish-${source}.log"
  local start_ts end_ts elapsed status
  start_ts="$(date +%s)"

  local cmd=(docker compose run --rm --no-deps crawler python -m oghma.publish --source "$source")
  if [[ "${OGHMA_PUBLISH_NO_UPLOAD:-0}" == "1" ]]; then
    cmd+=(--no-upload)
  fi
  if [[ "${OGHMA_PUBLISH_DRY_RUN:-0}" == "1" ]]; then
    cmd+=(--dry-run)
  fi
  if [[ "${OGHMA_PUBLISH_FULL:-0}" == "1" ]]; then
    cmd+=(--full)
  fi

  {
    echo "==== $(date -Is) publish start source=${source} ===="
    printf 'cmd:'
    printf ' %q' "${cmd[@]}"
    printf '\n'
  } | tee -a "$MAIN_LOG" "$source_log"

  run_command_with_retries "publish source=${source}" "${cmd[@]}" 2>&1 | tee -a "$MAIN_LOG" "$source_log"
  status="${PIPESTATUS[0]}"
  end_ts="$(date +%s)"
  elapsed="$((end_ts - start_ts))"

  echo "==== $(date -Is) publish finish source=${source} exit=${status} ====" | tee -a "$MAIN_LOG" "$source_log"
  echo "${source}|${status}|${elapsed}" >> "$TMP_PUBLISH_RESULTS"
  return 0
}

TMP_RESULTS_DIR="$(mktemp -d)"
TMP_PUBLISH_RESULTS="$(mktemp)"
TMP_CRAWL_SUMMARY="$(mktemp)"
TMP_PUBLISH_SUMMARY="$(mktemp)"
START_TS="$(date +%s)"
OVERALL_STATUS="ok"

{
  echo "==== $(date -Is) daily completed-crawlers start ===="
  echo "sources: ${SOURCES}"
  echo "shutdown_when_done: ${SHUTDOWN_WHEN_DONE}"
} | tee -a "$MAIN_LOG"

if ! wait_for_stack; then
  {
    echo "**Oghma Monitor - Daily crawl nao iniciou**"
    echo "Status: **ATENCAO**"
    echo "Motivo: Docker/Postgres nao ficaram prontos em \`${BOOT_WAIT_SECONDS}s\`"
    if [[ "$SHUTDOWN_WHEN_DONE" == "1" ]]; then
      echo "Servidor: acordado pela rotina; desligamento agendado"
    else
      echo "Servidor: ja estava ligado; mantido ligado"
    fi
    echo "Log: \`${MAIN_LOG}\`"
  } > "$SUMMARY_FILE"
  cat "$SUMMARY_FILE" | tee -a "$MAIN_LOG"
  if [[ -x "${PROJECT_DIR}/deploy/discord-dm.py" ]]; then
    python3 "${PROJECT_DIR}/deploy/discord-dm.py" "$SUMMARY_FILE" 2>&1 | tee -a "$MAIN_LOG" || true
  fi
  rm -rf "$TMP_RESULTS_DIR"
  rm -f "$TMP_PUBLISH_RESULTS" "$TMP_CRAWL_SUMMARY" "$TMP_PUBLISH_SUMMARY"
  if [[ "$SHUTDOWN_WHEN_DONE" == "1" ]]; then
    echo "==== $(date -Is) scheduling shutdown after readiness failure ====" | tee -a "$MAIN_LOG"
    sudo -n shutdown -h now || shutdown -h now || true
  fi
  exit 1
fi

run_crawlers

if [[ "$PUBLISH_AFTER_CRAWL" == "1" ]]; then
  echo "==== $(date -Is) publish all daily sources start ====" | tee -a "$MAIN_LOG"
  for source in $SOURCES; do
    publish_source "$source"
  done
else
  echo "==== $(date -Is) publish skipped by OGHMA_PUBLISH_AFTER_CRAWL=${PUBLISH_AFTER_CRAWL} ====" | tee -a "$MAIN_LOG"
fi

END_TS="$(date +%s)"
ELAPSED="$((END_TS - START_TS))"

printf "%-14s %-12s %-14s %-11s %-8s\n" "Fonte" "Novels" "Capitulos" "Tempo" "Status" > "$TMP_CRAWL_SUMMARY"
printf "%-14s %-12s %-14s %-11s %-8s\n" "-------------" "-----------" "-------------" "----------" "-------" >> "$TMP_CRAWL_SUMMARY"

for source_id in $SOURCES; do
  if [[ -f "$TMP_RESULTS_DIR/$source_id" ]]; then
    IFS='|' read -r source status novels_before novels_after novels_added chapters_before chapters_after chapters_added elapsed < "$TMP_RESULTS_DIR/$source_id"
  else
    source="$source_id"
    status="missing"
    novels_before=0
    novels_after=0
    novels_added=0
    chapters_before=0
    chapters_after=0
    chapters_added=0
    elapsed=0
  fi
  if [[ "$status" == "skipped" ]]; then
    printf "%-14s %-12s %-14s %-11s %-8s\n" "$(source_label "$source")" "-" "-" "-" "PULADO" >> "$TMP_CRAWL_SUMMARY"
    OVERALL_STATUS="partial_failure"
    continue
  fi
  if [[ "$status" != "0" ]]; then
    OVERALL_STATUS="partial_failure"
  fi
  printf "%-14s +%-11s +%-13s %-11s %-8s\n" \
    "$(source_label "$source")" "$novels_added" "$chapters_added" "$(duration "$elapsed")" "$(exit_label "$status")" >> "$TMP_CRAWL_SUMMARY"
done

if [[ "$PUBLISH_AFTER_CRAWL" == "1" ]]; then
  printf "%-14s %-11s %-8s\n" "Fonte" "Tempo" "Status" > "$TMP_PUBLISH_SUMMARY"
  printf "%-14s %-11s %-8s\n" "-------------" "----------" "-------" >> "$TMP_PUBLISH_SUMMARY"
  while IFS='|' read -r source status elapsed; do
    if [[ "$status" != "0" ]]; then
      OVERALL_STATUS="partial_failure"
    fi
    printf "%-14s %-11s %-8s\n" "$(source_label "$source")" "$(duration "$elapsed")" "$(exit_label "$status")" >> "$TMP_PUBLISH_SUMMARY"
  done < "$TMP_PUBLISH_RESULTS"
fi

{
  if [[ "$OVERALL_STATUS" == "ok" ]]; then
    echo "**Oghma Monitor - Daily crawl finalizado**"
    echo "Status: **OK**"
  else
    echo "**Oghma Monitor - Daily crawl finalizado**"
    echo "Status: **ATENCAO**"
  fi
  echo "Duracao: \`$(duration "$ELAPSED")\`"
  if [[ "$SHUTDOWN_WHEN_DONE" == "1" ]]; then
    echo "Servidor: acordado pela rotina; desligamento agendado"
  else
    echo "Servidor: ja estava ligado; mantido ligado"
  fi
  if [[ "${OGHMA_CRAWL_LIMIT:-}" || "${OGHMA_CHAPTER_LIMIT:-}" ]]; then
    echo "Modo: teste limitado"
  fi
  echo
  echo "**Crawlers**"
  echo '```text'
  cat "$TMP_CRAWL_SUMMARY"
  echo '```'
  if [[ "$PUBLISH_AFTER_CRAWL" == "1" ]]; then
    echo "**Publicacao B2**"
    if [[ "${OGHMA_PUBLISH_NO_UPLOAD:-0}" == "1" ]]; then
      echo "Modo: sem upload real"
    fi
    echo '```text'
    cat "$TMP_PUBLISH_SUMMARY"
    echo '```'
  else
    echo "**Publicacao B2:** pulada"
  fi
  echo "Log: \`${MAIN_LOG}\`"
} > "$SUMMARY_FILE"

cat "$SUMMARY_FILE" | tee -a "$MAIN_LOG"

if [[ -x "${PROJECT_DIR}/deploy/discord-dm.py" ]]; then
  python3 "${PROJECT_DIR}/deploy/discord-dm.py" "$SUMMARY_FILE" 2>&1 | tee -a "$MAIN_LOG" || true
fi

rm -rf "$TMP_RESULTS_DIR"
rm -f "$TMP_PUBLISH_RESULTS" "$TMP_CRAWL_SUMMARY" "$TMP_PUBLISH_SUMMARY"

if [[ "$SHUTDOWN_WHEN_DONE" == "1" ]]; then
  echo "==== $(date -Is) scheduling shutdown ====" | tee -a "$MAIN_LOG"
  sudo -n shutdown -h now || shutdown -h now || true
fi

if [[ "$OVERALL_STATUS" == "ok" ]]; then
  exit 0
fi
exit 1
