#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="${OGHMA_PROJECT_DIR:-/home/codex/oghma}"
LOG_FILE="${OGHMA_CRAWL_LOG_FILE:-/srv/oghma/logs/crawl-central-novel.log}"

cd "$PROJECT_DIR"

echo "== Processos de crawl =="
pgrep -af "oghma crawl --source central-novel" || echo "nenhum crawl rodando"

echo
echo "== Ultimas linhas do log =="
tail -n 20 "$LOG_FILE" 2>/dev/null || echo "log ainda nao existe: $LOG_FILE"

echo
echo "== Banco =="
docker compose exec -T db psql -U oghma -d oghma -c "
select count(*) as novels from novel;
select count(*) as chapters from chapter;
select count(*) filter (where cover_path is not null) as novels_with_cover from novel;
select
  id,
  status,
  stats->>'stage' as stage,
  concat(coalesce(stats->>'current_novel_index','0'), '/', coalesce(stats->>'novels_total', stats->>'discovered_total', '?')) as novels_progress,
  stats->>'current_novel_title' as current_novel,
  concat(coalesce(stats->>'current_novel_chapters_done','0'), '/', coalesce(stats->>'current_novel_chapters_total','?')) as chapters_progress,
  stats->>'current_chapter_number' as chapter,
  stats->>'last_event' as last_event,
  stats->>'last_heartbeat_at' as heartbeat,
  case
    when status = 'running'
     and nullif(stats->>'last_heartbeat_at','') is not null
     and (nullif(stats->>'last_heartbeat_at',''))::timestamptz < now() - interval '10 minutes'
    then 'STALE?'
    else ''
  end as alert
from crawl_run
order by id desc
limit 5;
"

echo
echo "== Arquivos =="
printf "covers "; find /srv/oghma/files/covers -type f 2>/dev/null | wc -l
printf "raw "; find /srv/oghma/files/raw -type f 2>/dev/null | wc -l
printf "content "; find /srv/oghma/files/content -type f 2>/dev/null | wc -l
