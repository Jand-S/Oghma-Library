from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

MONITOR_HTML = """<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Oghma Crawl Monitor</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #0d1115;
      --panel: #141a20;
      --panel-2: #1a2028;
      --text: #eef5f3;
      --muted: #8fa0a3;
      --line: #26313a;
      --accent: #00796B;
      --accent-2: #00a78f;
      --warn: #d9a441;
      --bad: #e05c5c;
      --ok: #37c078;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    header {
      position: sticky;
      top: 0;
      z-index: 2;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 18px 24px;
      background: rgba(13, 17, 21, 0.94);
      border-bottom: 1px solid var(--line);
      backdrop-filter: blur(16px);
    }

    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 18px; letter-spacing: 0; }
    h2 { font-size: 15px; margin-bottom: 14px; }
    h3 { font-size: 15px; line-height: 1.2; }

    .header-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }

    .dot {
      width: 9px;
      height: 9px;
      border-radius: 999px;
      background: var(--ok);
      box-shadow: 0 0 0 4px rgba(55, 192, 120, 0.12);
    }

    main {
      display: grid;
      gap: 18px;
      padding: 20px 24px 32px;
    }

    .summary {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 12px;
    }

    .metric, .panel, .run {
      border: 1px solid var(--line);
      background: var(--panel);
      border-radius: 8px;
    }

    .metric { padding: 14px; }
    .metric strong { display: block; font-size: 24px; margin-top: 6px; }
    .metric span { color: var(--muted); font-size: 12px; }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 340px;
      gap: 18px;
      align-items: start;
    }

    .panel { padding: 16px; min-width: 0; }

    .run-list {
      display: grid;
      gap: 12px;
      max-height: calc(100vh - 252px);
      overflow: auto;
      padding-right: 2px;
    }

    .run {
      padding: 14px;
      min-width: 0;
    }

    .run-section {
      display: grid;
      gap: 10px;
    }

    .run-section + .run-section {
      padding-top: 14px;
      border-top: 1px solid var(--line);
    }

    .section-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .section-head h3 {
      color: var(--text);
      font-size: 14px;
    }

    .source-group {
      display: grid;
      gap: 8px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #10161c;
    }

    .source-group-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      color: var(--muted);
      font-size: 12px;
    }

    .source-group-head strong {
      color: var(--text);
      font-size: 13px;
    }

    .run.compact {
      padding: 11px;
      background: #121920;
    }

    .run-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 12px;
    }

    .source {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 26px;
      padding: 3px 9px;
      border-radius: 999px;
      border: 1px solid var(--line);
      background: var(--panel-2);
      color: var(--text);
      font-size: 12px;
      white-space: nowrap;
    }

    .badge.running { border-color: rgba(0, 121, 107, 0.7); color: #dffcf7; background: rgba(0, 121, 107, 0.18); }
    .badge.done { border-color: rgba(55, 192, 120, 0.55); color: #ddfbe9; background: rgba(55, 192, 120, 0.14); }
    .badge.error { border-color: rgba(224, 92, 92, 0.55); color: #ffdede; background: rgba(224, 92, 92, 0.14); }
    .badge.stale { border-color: rgba(217, 164, 65, 0.7); color: #ffe8b5; background: rgba(217, 164, 65, 0.15); }

    .status-strip {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .progress-group {
      display: grid;
      gap: 10px;
      margin: 12px 0;
    }

    .progress-row {
      display: grid;
      grid-template-columns: 92px minmax(0, 1fr) 84px;
      align-items: center;
      gap: 10px;
      color: var(--muted);
      font-size: 12px;
    }

    .bar {
      height: 8px;
      overflow: hidden;
      border-radius: 999px;
      background: #0a0e12;
      border: 1px solid #22303a;
    }

    .bar > i {
      display: block;
      width: 0%;
      height: 100%;
      border-radius: inherit;
      background: linear-gradient(90deg, var(--accent), var(--accent-2));
      transition: width 280ms ease;
    }

    .details {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      margin-top: 12px;
    }

    .detail {
      min-width: 0;
      border: 1px solid var(--line);
      border-radius: 7px;
      padding: 8px;
      background: #11171d;
    }

    .detail span {
      display: block;
      color: var(--muted);
      font-size: 11px;
      margin-bottom: 4px;
    }

    .detail strong {
      display: block;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }

    .event {
      margin-top: 12px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .side-list {
      display: grid;
      gap: 10px;
      color: var(--muted);
      font-size: 13px;
    }

    .side-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 9px 0;
      border-bottom: 1px solid var(--line);
    }

    .side-row:last-child { border-bottom: 0; }
    .side-row strong { color: var(--text); text-align: right; }

    .action-button {
      width: 100%;
      min-height: 40px;
      margin: 2px 0 12px;
      border: 1px solid rgba(0, 121, 107, 0.72);
      border-radius: 7px;
      background: var(--accent);
      color: #f3fffc;
      cursor: pointer;
      font: inherit;
      font-size: 13px;
      font-weight: 700;
      transition: background 180ms ease, border-color 180ms ease, opacity 180ms ease;
    }

    .action-button:hover { background: #008d7d; border-color: rgba(0, 167, 143, 0.85); }
    .action-button:disabled { cursor: default; opacity: 0.54; background: #16423e; border-color: #255a55; }

    .publish-status {
      display: grid;
      gap: 8px;
      margin-bottom: 12px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 7px;
      background: #11171d;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
      overflow-wrap: anywhere;
    }

    .publish-status strong {
      display: block;
      color: var(--text);
      font-size: 13px;
    }

    .empty {
      border: 1px dashed var(--line);
      border-radius: 8px;
      padding: 26px;
      color: var(--muted);
      text-align: center;
    }

    @media (max-width: 940px) {
      header { align-items: flex-start; flex-direction: column; }
      .summary { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .grid { grid-template-columns: 1fr; }
      .run-list { max-height: none; }
    }

    @media (max-width: 620px) {
      main, header { padding-left: 14px; padding-right: 14px; }
      .summary { grid-template-columns: 1fr; }
      .progress-row { grid-template-columns: 1fr; }
      .details { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Oghma Crawl Monitor</h1>
      <p class="source">Acompanhamento em tempo real dos crawlers</p>
    </div>
    <div class="header-meta">
      <span class="dot" id="apiDot"></span>
      <span id="apiStatus">conectando...</span>
      <span id="lastRefresh"></span>
    </div>
  </header>

  <main>
    <section class="summary">
      <div class="metric"><span>Runs ativos</span><strong id="runningCount">0</strong></div>
      <div class="metric"><span>Novels no banco</span><strong id="novelCount">0</strong></div>
      <div class="metric"><span>Capitulos no banco</span><strong id="chapterCount">0</strong></div>
      <div class="metric"><span>Capas preservadas</span><strong id="coverCount">0</strong></div>
    </section>

    <section class="grid">
      <div class="panel">
        <h2>Execucoes recentes</h2>
        <div id="runs" class="run-list">
          <div class="empty">Carregando crawls...</div>
        </div>
      </div>

      <aside class="panel">
        <h2>Resumo operacional</h2>
        <button id="publishButton" class="action-button" type="button">Publicar todos no B2</button>
        <div id="publishStatus" class="publish-status">
          <strong>Publish</strong>
          <span>consultando status...</span>
        </div>
        <div class="side-list">
          <div class="side-row"><span>Atualizacao</span><strong id="refreshInterval">2s</strong></div>
          <div class="side-row"><span>Alerta stale</span><strong>10 min</strong></div>
          <div class="side-row"><span>Endpoint</span><strong>/api/crawls</strong></div>
          <div class="side-row"><span>Publish</span><strong>/api/publish</strong></div>
          <div class="side-row"><span>Multi-site</span><strong>por source_id</strong></div>
        </div>
      </aside>
    </section>
  </main>

  <script>
    const pollMs = 2000;

    const $ = (id) => document.getElementById(id);
    const fmt = new Intl.NumberFormat("pt-BR");

    function asNumber(value) {
      const num = Number(value || 0);
      return Number.isFinite(num) ? num : 0;
    }

    function pct(done, total) {
      done = asNumber(done);
      total = asNumber(total);
      if (!total) return 0;
      return Math.max(0, Math.min(100, (done / total) * 100));
    }

    function text(value, fallback = "-") {
      if (value === null || value === undefined || value === "") return fallback;
      return String(value);
    }

    function relativeTime(iso) {
      if (!iso) return "-";
      const at = new Date(iso);
      if (Number.isNaN(at.getTime())) return "-";
      const seconds = Math.max(0, Math.round((Date.now() - at.getTime()) / 1000));
      if (seconds < 60) return `${seconds}s atras`;
      const minutes = Math.round(seconds / 60);
      if (minutes < 60) return `${minutes}min atras`;
      return `${Math.round(minutes / 60)}h atras`;
    }

    function isStale(run) {
      if (run.status !== "running") return false;
      const heartbeat = run.stats?.last_heartbeat_at;
      if (!heartbeat) return false;
      return Date.now() - new Date(heartbeat).getTime() > 10 * 60 * 1000;
    }

    function statusBadge(run) {
      const stale = isStale(run);
      const label = stale ? "stale?" : run.status;
      return `<span class="badge ${stale ? "stale" : run.status}">${label}</span>`;
    }

    function progressRow(label, done, total) {
      const width = pct(done, total);
      return `
        <div class="progress-row">
          <span>${label}</span>
          <div class="bar"><i style="width:${width}%"></i></div>
          <span>${fmt.format(asNumber(done))}/${fmt.format(asNumber(total))}</span>
        </div>`;
    }

    function groupBySource(runs) {
      return runs.reduce((groups, run) => {
        const key = run.sourceId || "sem-fonte";
        if (!groups[key]) groups[key] = [];
        groups[key].push(run);
        return groups;
      }, {});
    }

    function runSort(a, b) {
      return new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime();
    }

    function sourceLabel(sourceId) {
      return String(sourceId || "sem-fonte").replace(/-/g, " ");
    }

    function statusCounts(runs) {
      const counts = runs.reduce((acc, run) => {
        const status = isStale(run) ? "stale" : run.status;
        acc[status] = (acc[status] || 0) + 1;
        return acc;
      }, {});
      return Object.entries(counts)
        .map(([status, count]) => `<span class="badge ${status}">${status}: ${fmt.format(count)}</span>`)
        .join("");
    }

    function renderRunSection(title, runs, emptyText) {
      const sorted = [...runs].sort(runSort);
      return `
        <section class="run-section">
          <div class="section-head">
            <h3>${title}</h3>
            <span>${fmt.format(sorted.length)} runs</span>
          </div>
          ${sorted.length ? sorted.map((run) => renderRun(run, true)).join("") : `<div class="empty">${emptyText}</div>`}
        </section>`;
    }

    function renderSourceGroup(sourceId, runs) {
      const sorted = [...runs].sort(runSort);
      const latest = sorted[0];
      return `
        <div class="source-group">
          <div class="source-group-head">
            <strong>${sourceLabel(sourceId)}</strong>
            <div class="status-strip">${statusCounts(sorted)}</div>
          </div>
          ${renderRun(latest, true)}
        </div>`;
    }

    function renderGroupedRuns(runs) {
      if (!runs.length) return `<div class="empty">Nenhum crawl registrado ainda.</div>`;
      const running = runs.filter((run) => run.status === "running" && !isStale(run));
      const attention = runs.filter((run) => run.status === "error" || isStale(run));
      const historical = runs.filter((run) => run.status !== "running" && !isStale(run));
      const sourceGroups = groupBySource(historical);
      const sources = Object.keys(sourceGroups).sort();

      return `
        ${renderRunSection("Rodando agora", running, "Nenhum crawler ativo no momento.")}
        ${renderRunSection("Precisam de atencao", attention, "Sem erros ou crawlers travados recentes.")}
        <section class="run-section">
          <div class="section-head">
            <h3>Historico por fonte</h3>
            <span>${fmt.format(historical.length)} runs</span>
          </div>
          ${sources.length
            ? sources.map((sourceId) => renderSourceGroup(sourceId, sourceGroups[sourceId])).join("")
            : `<div class="empty">Sem historico finalizado ainda.</div>`}
        </section>`;
    }

    function renderRun(run, compact = false) {
      const s = run.stats || {};
      const novelsDone = asNumber(s.novels_done || s.novels);
      const novelsTotal = asNumber(s.novels_total || s.discovered_total);
      const chapterDone = asNumber(s.current_novel_chapters_done);
      const chapterTotal = asNumber(s.current_novel_chapters_total);
      return `
        <article class="run ${compact ? "compact" : ""}">
          <div class="run-head">
            <div>
              <h3>${text(s.current_novel_title, run.sourceId)}</h3>
              <p class="source">${run.sourceId} · run #${run.id} · ${text(s.stage, "sem etapa")}</p>
            </div>
            ${statusBadge(run)}
          </div>

          <div class="progress-group">
            ${progressRow("Novels", novelsDone, novelsTotal)}
            ${progressRow("Capitulos", chapterDone, chapterTotal)}
          </div>

          <div class="details">
            <div class="detail"><span>Capitulo atual</span><strong>${text(s.current_chapter_number)} ${text(s.current_chapter_title, "")}</strong></div>
            <div class="detail"><span>Novos / pulados</span><strong>${fmt.format(asNumber(s.chapters_new))} / ${fmt.format(asNumber(s.chapters_skipped))}</strong></div>
            <div class="detail"><span>Heartbeat</span><strong>${relativeTime(s.last_heartbeat_at)}</strong></div>
          </div>

          <p class="event">${text(s.last_event, run.error || "sem evento recente")}</p>
        </article>`;
    }

    function formatDateTime(seconds) {
      if (!seconds) return "-";
      return new Date(seconds * 1000).toLocaleString("pt-BR");
    }

    function renderPublish(job) {
      if (!job || !job.status) return "<strong>Publish</strong><span>status indisponivel</span>";
      if (job.status === "running") {
        return `<strong>Publish em andamento</strong><span>Fonte: ${text(job.source, "all")}</span><span>Inicio: ${formatDateTime(job.startedAt)}</span>`;
      }
      if (job.status === "done") {
        const s = job.summary || {};
        const sourceLabel = s.source_count ? `${fmt.format(asNumber(s.source_count))} sites · ` : "";
        const catalogLabel = s.sources
          ? s.sources.map((item) => `${item.source}: ${text(item.summary?.catalog_json_key, "-")}`).join(" | ")
          : text(s.catalog_json_key, "catalogo json nao informado");
        return `<strong>Ultimo publish concluido</strong><span>${sourceLabel}${fmt.format(asNumber(s.novels))} novels · ${fmt.format(asNumber(s.bundles_changed))} bundles · ${fmt.format(asNumber(s.covers))} capas</span><span>${catalogLabel}</span>`;
      }
      if (job.status === "error") {
        return `<strong>Publish com erro</strong><span>${text(job.error, "erro desconhecido")}</span>`;
      }
      return `<strong>Publish</strong><span>pronto para publicar todos os sites no B2</span>`;
    }

    async function loadPublish() {
      try {
        const res = await fetch("/api/publish/status", { cache: "no-store" });
        if (!res.ok) throw new Error("publish status indisponivel");
        const job = await res.json();
        $("publishStatus").innerHTML = renderPublish(job);
        $("publishButton").disabled = job.status === "running";
        $("publishButton").textContent = job.status === "running" ? "Publicando..." : "Publicar todos no B2";
      } catch (error) {
        $("publishStatus").innerHTML = `<strong>Publish</strong><span>nao consegui consultar o status</span>`;
        $("publishButton").disabled = false;
      }
    }

    async function triggerPublish() {
      $("publishButton").disabled = true;
      $("publishButton").textContent = "Disparando...";
      $("publishStatus").innerHTML = `<strong>Publish</strong><span>iniciando publicacao...</span>`;
      try {
        const res = await fetch("/api/publish/run?source=all", { method: "POST" });
        if (!res.ok) throw new Error("falha ao iniciar publish");
        const payload = await res.json();
        $("publishStatus").innerHTML = renderPublish(payload.job);
      } catch (error) {
        $("publishStatus").innerHTML = `<strong>Publish</strong><span>erro ao iniciar publicacao</span>`;
      } finally {
        await loadPublish();
      }
    }

    async function load() {
      try {
        const [runsRes, statsRes] = await Promise.all([
          fetch("/api/crawls?limit=60", { cache: "no-store" }),
          fetch("/api/stats", { cache: "no-store" }),
        ]);
        if (!runsRes.ok || !statsRes.ok) throw new Error("API indisponivel");
        const runs = await runsRes.json();
        const stats = await statsRes.json();

        $("apiDot").style.background = "var(--ok)";
        $("apiStatus").textContent = "online";
        $("lastRefresh").textContent = `atualizado ${new Date().toLocaleTimeString("pt-BR")}`;
        $("runningCount").textContent = fmt.format(runs.filter((run) => run.status === "running").length);
        $("novelCount").textContent = fmt.format(stats.novels || 0);
        $("chapterCount").textContent = fmt.format(stats.chapters || 0);
        $("coverCount").textContent = fmt.format(stats.covers || 0);
        $("runs").innerHTML = renderGroupedRuns(runs);
      } catch (error) {
        $("apiDot").style.background = "var(--bad)";
        $("apiStatus").textContent = "offline";
        $("lastRefresh").textContent = "";
        $("runs").innerHTML = `<div class="empty">Nao consegui consultar a API agora. Tentando novamente...</div>`;
      }
    }

    $("publishButton").addEventListener("click", triggerPublish);
    load();
    loadPublish();
    setInterval(load, pollMs);
    setInterval(loadPublish, pollMs);
  </script>
</body>
</html>
"""


@router.get("/monitor", response_class=HTMLResponse)
async def crawl_monitor():
    return HTMLResponse(MONITOR_HTML)
