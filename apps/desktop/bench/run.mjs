#!/usr/bin/env node
// Performance benchmark: old vs new UI.
//
//   node run.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --runs 7 --out results/<dir>
//   node run.mjs --serve --runs 7 --out results/<dir>          # starts `vite preview` for both dist-bench
//
// Options: --runs N (7) · --cpu-throttle X (1) · --queue-size N (12) · --queue-delay ms (4000)
//          --search kraken,zephyr,... · --only old|new · --skip-queue · --old-dist/--new-dist <dist-bench dir>
//          --headed
import path from "node:path";
import fs from "node:fs";
import { versions } from "./versions.mjs";
import { expectedSearch, loadFixtures } from "./lib/fixtures.mjs";
import { cdpMetrics, disableCache, launchBrowser, newBenchContext, setCpuThrottle } from "./lib/context.mjs";
import { analyzeDist } from "./lib/assets.mjs";
import { fmt, mdTable, parseArgs, quantile, resolveTargets, sleep, summarize, writeJson } from "./lib/common.mjs";
import { sanitizeFileName } from "./fixtures/generate.mjs";

const args = parseArgs();
const RUNS = Number(args.runs || 7);
const OUT = path.resolve(args.out || `results/run-${new Date().toISOString().slice(0, 10)}`);
const CPU = Number(args["cpu-throttle"] || 1);
const QUEUE_SIZE = Number(args["queue-size"] || 12);
const QUEUE_DELAY = Number(args["queue-delay"] || 4000);
const SETTLE_MS = Number(args.settle || 1500);

const fx = loadFixtures();
// ASCII-only queries so accent-folding changes in the new UI don't change the expected result sets.
const SEARCH_QUERIES = String(args["search"] || [...fx.manifest.searchTokens, "mago", "sombra"].join(","))
  .split(",")
  .map((q) => q.trim().toLowerCase())
  .filter(Boolean);

// ---------------------------------------------------------------------------------------------
// In-page helpers
// ---------------------------------------------------------------------------------------------
const PREDICATE_SET = `(args) => {
  const cards = document.querySelectorAll(args.card);
  if (!cards.length) return false;
  if (args.count != null && cards.length !== args.count) return false;
  const set = window.__benchExpected[args.key];
  for (const card of cards) {
    const el = card.querySelector(args.title);
    const text = (el ? el.textContent : "").trim();
    if (!set.has(text)) return false;
  }
  return true;
}`;
const PREDICATE_COUNT = `(args) => document.querySelectorAll(args.card).length >= args.min`;

async function arm(page, id, { eventType, predicate, predicateArgs, timeoutMs }) {
  await page.evaluate(
    ([waitId, opts]) => window.__BENCH_PROBE__.arm(waitId, opts),
    [id, { eventType, predicateSource: predicate, args: predicateArgs, timeoutMs }]
  );
}
const awaitArm = (page, id) => page.evaluate((waitId) => window.__BENCH_PROBE__[`wait_${waitId}`], id);

function tbt(longtasks, from, to) {
  let total = 0;
  let count = 0;
  for (const task of longtasks) {
    if (task.start < from || task.start >= to) continue;
    total += Math.max(0, task.duration - 50);
    count += 1;
  }
  return { tbt: total, longtasks: count };
}

// ---------------------------------------------------------------------------------------------
// One perf run (fresh context = cold load)
// ---------------------------------------------------------------------------------------------
async function perfRun(browser, version, url, runIndex) {
  const { context } = await newBenchContext(browser, { version });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await disableCache(page);
  await setCpuThrottle(page, CPU);
  const loaded = [];
  page.on("response", (response) => {
    const u = response.url();
    if (u.startsWith(url) && /\.(js|css)$/.test(u)) loaded.push(u.slice(url.length));
  });
  const result = { run: runIndex, version: version.id };

  // ---- cold load ----
  await page.goto(url, { waitUntil: "commit" });
  await version.waitShell(page, { timeout: 30000 });
  await version.waitDiscoverCards(page, 24, 30000);
  await sleep(SETTLE_MS);
  const cold = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0];
    return {
      marks: window.__BENCH_PROBE__.marks,
      fcp: fcp ? fcp.startTime : null,
      domContentLoaded: nav ? nav.domContentLoadedEventEnd : null,
      longtasks: window.__BENCH_PROBE__.longtasks
    };
  });
  const m = cold.marks;
  const shellVisible = m.shell != null ? Math.max(m.shell, m.splashGone ?? m.shell) : null;
  const coldEnd = Math.max(m.cards24 ?? 0, shellVisible ?? 0);
  result.cold = {
    fcp: cold.fcp,
    domContentLoaded: cold.domContentLoaded,
    shellMounted: m.shell ?? null,
    shellVisible,
    firstCard: m.firstCard ?? null,
    cards24: m.cards24 ?? null,
    ...(() => {
      const t = tbt(cold.longtasks, 0, coldEnd + 1);
      return { tbt: t.tbt, longtasks: t.longtasks };
    })()
  };
  result.heapIdle = await cdpMetrics(page);

  // ---- Discover search: keystroke -> results updated ----
  // Types each query char by char (measuring every keystroke whose expected result set differs from
  // what is on screen), then clears the field (select-all + Backspace, measured as "clear -> full").
  const box = version.searchBox(page);
  await box.click();
  const pageSize = version.discoverPageSize;
  const full = expectedSearch("");
  await page.evaluate((titles) => {
    window.__benchExpected = window.__benchExpected || {};
    window.__benchExpected.q_full = new Set(titles);
  }, full);
  const keystrokes = [];
  const clears = [];
  for (const query of SEARCH_QUERIES) {
    let prevTitles = full;
    let prefix = "";
    for (const ch of query) {
      prefix += ch;
      const next = expectedSearch(prefix);
      const nextSet = new Set(next);
      const prevVisible = prevTitles.slice(0, pageSize ?? 60);
      const countChanged = pageSize != null && Math.min(prevTitles.length, pageSize) !== Math.min(next.length, pageSize);
      const measurable = next.length > 0 && (prevVisible.some((title) => !nextSet.has(title)) || countChanged);
      if (measurable) {
        const key = `q_${prefix}`;
        await page.evaluate(([k, titles]) => {
          window.__benchExpected[k] = new Set(titles);
        }, [key, next]);
        await arm(page, key, {
          eventType: "keydown",
          predicate: PREDICATE_SET,
          predicateArgs: {
            key,
            card: version.sel.discoverCard,
            title: version.sel.discoverCardTitle,
            count: pageSize != null ? Math.min(next.length, pageSize) : null
          },
          timeoutMs: 15000
        });
        await page.keyboard.type(ch);
        const r = await awaitArm(page, key);
        keystrokes.push({ query, prefix, expected: next.length, t0: r.t0, t1: r.t1, tPaint: r.tPaint ?? null, timeout: Boolean(r.timeout) });
      } else {
        await page.keyboard.type(ch);
        await sleep(200);
        keystrokes.push({ query, prefix, expected: next.length, skipped: true });
      }
      prevTitles = next;
    }
    // clear -> full catalog back
    await box.press("ControlOrMeta+A");
    await box.evaluate((el) => el.select && el.select());
    await arm(page, "q_clear", {
      eventType: "keydown",
      predicate: PREDICATE_SET,
      predicateArgs: { key: "q_full", card: version.sel.discoverCard, title: version.sel.discoverCardTitle, count: pageSize != null ? Math.min(full.length, pageSize) : null },
      timeoutMs: 15000
    });
    await page.keyboard.press("Backspace");
    const clear = await awaitArm(page, "q_clear");
    clears.push({ query, t0: clear.t0, t1: clear.t1, tPaint: clear.tPaint ?? null, timeout: Boolean(clear.timeout) });
    await sleep(150);
  }
  const measured = keystrokes.filter((k) => !k.skipped && !k.timeout);
  const latencies = measured.map((k) => k.tPaint - k.t0);
  const clearLatencies = clears.filter((c) => !c.timeout).map((c) => c.tPaint - c.t0);
  const lt1 = await page.evaluate(() => window.__BENCH_PROBE__.longtasks);
  const searchFrom = measured.length ? measured[0].t0 : null;
  const lastClear = clears.filter((c) => !c.timeout).pop();
  const searchTo = lastClear?.t1 ?? (measured.length ? measured[measured.length - 1].t1 : null);
  result.search = {
    queries: SEARCH_QUERIES,
    keystrokes,
    clears,
    measuredKeystrokes: measured.length,
    timeouts: keystrokes.filter((k) => k.timeout).length + clears.filter((c) => c.timeout).length,
    keystrokeMedian: quantile(latencies, 0.5),
    keystrokeMax: latencies.length ? Math.max(...latencies) : null,
    latencies,
    clearToFull: quantile(clearLatencies, 0.5),
    ...(searchFrom != null && searchTo != null ? tbt(lt1, searchFrom, searchTo + 1) : { tbt: null, longtasks: null })
  };
  await sleep(300);

  // ---- scroll FPS on the results grid ----
  if (version.expandResults) await version.expandResults(page, 240);
  const scroll = await page.evaluate(
    async ([scrollerSel, cardSel, durationMs]) => {
      const scrollable = (el) => el && el.scrollHeight > el.clientHeight + 100 && /(auto|scroll)/.test(getComputedStyle(el).overflowY);
      let el = scrollerSel ? document.querySelector(scrollerSel) : null;
      if (!scrollable(el)) {
        el = document.querySelector(cardSel);
        while (el && !scrollable(el)) el = el.parentElement;
      }
      if (!el) el = document.scrollingElement;
      const range = el.scrollHeight - el.clientHeight;
      const cards = document.querySelectorAll(cardSel).length;
      const speed = 2000; // px/s
      el.scrollTop = 0;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const frames = [];
      const ltBefore = window.__BENCH_PROBE__.longtasks.length;
      const start = performance.now();
      await new Promise((resolve) => {
        const step = (t) => {
          frames.push(t);
          const elapsed = t - start;
          const travel = (elapsed / 1000) * speed;
          const period = range * 2 || 1;
          const pos = travel % period;
          el.scrollTop = pos <= range ? pos : period - pos;
          if (elapsed < durationMs) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      const deltas = frames.slice(1).map((t, i) => t - frames[i]).sort((a, b) => a - b);
      const q = (p) => deltas[Math.min(deltas.length - 1, Math.floor(p * (deltas.length - 1)))];
      const medianDelta = q(0.5);
      const lts = window.__BENCH_PROBE__.longtasks.slice(ltBefore);
      return {
        scroller: el.className || el.tagName,
        range,
        cards,
        durationMs: frames[frames.length - 1] - frames[0],
        frames: frames.length,
        fps: (frames.length - 1) / ((frames[frames.length - 1] - frames[0]) / 1000),
        frameMedian: medianDelta,
        frameP95: q(0.95),
        frameMax: deltas[deltas.length - 1],
        jankFrames: deltas.filter((d) => d > 1.5 * medianDelta).length,
        longtasks: lts.length,
        tbt: lts.reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0)
      };
    },
    [version.sel.discoverScroller, version.sel.discoverCard, 3000]
  );
  result.scroll = scroll;

  // ---- Library with N books: nav click -> cards ----
  const libCount = fx.library.length;
  await arm(page, "lib24", { eventType: "click", predicate: PREDICATE_COUNT, predicateArgs: { card: version.sel.libraryCard, min: Math.min(24, libCount) }, timeoutMs: 15000 });
  await arm(page, "libAll", { eventType: "click", predicate: PREDICATE_COUNT, predicateArgs: { card: version.sel.libraryCard, min: libCount }, timeoutMs: 8000 });
  await version.navButton(page, "library").click();
  const lib24 = await awaitArm(page, "lib24");
  const libAll = await awaitArm(page, "libAll");
  await sleep(SETTLE_MS);
  const lt2 = await page.evaluate(() => window.__BENCH_PROBE__.longtasks);
  const libEnd = (libAll.t1 ?? lib24.t1 ?? lib24.t0) + 1;
  result.library = {
    books: libCount,
    to24: lib24.timeout ? null : lib24.tPaint - lib24.t0,
    toAll: libAll.timeout ? null : libAll.tPaint - libAll.t0,
    renderedCards: await page.locator(version.sel.libraryCard).count(),
    ...(lib24.t0 != null ? tbt(lt2, lib24.t0, libEnd) : { tbt: null, longtasks: null })
  };
  result.heapAfterLibrary = await cdpMetrics(page);
  result.errors = errors;
  result.loadedAssets = [...new Set(loaded)];
  await context.close();
  return result;
}

// ---------------------------------------------------------------------------------------------
// Queue load test: enqueue many, cancel the active download mid-flight
// ---------------------------------------------------------------------------------------------
async function queueTest(browser, version, url) {
  const { context, routes } = await newBenchContext(browser, { version, bundleDelayMs: QUEUE_DELAY });
  const page = await context.newPage();
  const out = { version: version.id, requested: QUEUE_SIZE, bundleDelayMs: QUEUE_DELAY };
  try {
    await page.goto(url);
    await version.waitShell(page);
    await version.waitDiscoverCards(page, 24);
    await sleep(500);
    out.accepted = await version.enqueueMany(page, QUEUE_SIZE);
    await version.goto(page, "downloads");
    const t0 = Date.now();
    while (!routes.state.bundleEvents.some((e) => e.phase === "request") && Date.now() - t0 < 15000) await sleep(50);
    await sleep(Math.min(1000, QUEUE_DELAY / 3));
    const pageCancelT = await page.evaluate(() => window.__BENCH__.mark("cancel"));
    const cancelT = Date.now();
    const cancelledTitle = await version.cancelActiveDownload(page);
    out.cancelledTitle = cancelledTitle;
    await sleep(QUEUE_DELAY + 4000);

    const novel = Object.values(fx.catalogs).flatMap((c) => c.novels).find((n) => n.title === cancelledTitle);
    const slug = novel?.slug;
    const events = routes.state.bundleEvents;
    const mine = events.filter((e) => e.slug === slug);
    const requestsBefore = events.filter((e) => e.phase === "request" && e.t <= cancelT);
    const settledBefore = new Set(events.filter((e) => (e.phase === "finished" || e.phase === "failed") && e.t <= cancelT).map((e) => e.url));
    const inflightAtCancel = requestsBefore.filter((e) => !settledBefore.has(e.url)).length;
    const nextStart = events.find((e) => e.phase === "request" && e.t > cancelT && e.slug !== slug);
    const shim = await page.evaluate(() => ({
      saves: window.__BENCH__.saves,
      toasts: window.__BENCH_PROBE__.toasts
    }));
    const cancelledDir = cancelledTitle ? sanitizeFileName(cancelledTitle) : "__none__";
    const savesAfter = shim.saves.filter((s) => s.t > pageCancelT);
    const zombieSaves = savesAfter.filter((s) => s.dir.endsWith(`/${cancelledDir}`));
    // concurrency
    let inflight = 0;
    let maxConcurrent = 0;
    for (const e of [...events].sort((a, b) => a.t - b.t)) {
      if (e.phase === "request") inflight += 1;
      if (e.phase === "finished" || e.phase === "failed") inflight -= 1;
      maxConcurrent = Math.max(maxConcurrent, inflight);
    }
    const reappeared = cancelledTitle ? await page.getByText(cancelledTitle, { exact: true }).count() : 0;
    out.result = {
      inflightAtCancel,
      cancelledRequestFinishedAfterCancel: mine.some((e) => e.phase === "finished" && e.t > cancelT),
      cancelledRequestAborted: mine.some((e) => e.phase === "failed" && e.t > cancelT),
      bundleRequestKeptRunning: mine.some((e) => e.phase === "finished" && e.t > cancelT),
      saveInvokesAfterCancel: savesAfter.length,
      zombieSavesForCancelledBook: zombieSaves.length,
      zombieSaveFiles: zombieSaves.map((s) => s.name),
      nextDownloadStartedAfterMs: nextStart ? nextStart.t - cancelT : null,
      cancelledItemVisibleAgain: reappeared > 0,
      toastsAfterCancel: shim.toasts.filter((t) => t.t > pageCancelT).map((t) => t.text),
      totalBundleRequests: events.filter((e) => e.phase === "request").length,
      maxConcurrentBundleRequests: maxConcurrent
    };
    out.bundleEvents = events.map((e) => ({ ...e, t: e.t - cancelT }));
  } catch (error) {
    out.error = String(error.stack || error);
  } finally {
    await context.close();
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------
const MB = 1024 * 1024;
const METRICS = [
  ["Cold load: FCP (ms)", (r) => r.cold.fcp],
  ["Cold load: shell mounted (ms)", (r) => r.cold.shellMounted],
  ["Cold load: shell visible / splash gone (ms)", (r) => r.cold.shellVisible],
  ["Cold load: first card (ms)", (r) => r.cold.firstCard],
  ["Cold load: 24 cards (ms)", (r) => r.cold.cards24],
  ["TBT cold load (ms)", (r) => r.cold.tbt],
  ["Search keystroke → results, per-run median (ms)", (r) => r.search.keystrokeMedian],
  ["Search keystroke → results, per-run max (ms)", (r) => r.search.keystrokeMax],
  ["Search clear → full list (ms)", (r) => r.search.clearToFull],
  ["TBT during search (ms)", (r) => r.search.tbt],
  ["Scroll FPS (3 s scripted)", (r) => r.scroll.fps],
  ["Scroll frame p95 (ms)", (r) => r.scroll.frameP95],
  ["Scroll jank frames (>1.5× median)", (r) => r.scroll.jankFrames],
  ["Library nav → 24 cards (ms)", (r) => r.library.to24],
  ["Library nav → all books rendered (ms)", (r) => r.library.toAll],
  ["TBT library nav (ms)", (r) => r.library.tbt],
  ["JS heap idle shell (MB, after GC)", (r) => r.heapIdle.JSHeapUsedSize / MB],
  ["JS heap after Library (MB, after GC)", (r) => r.heapAfterLibrary.JSHeapUsedSize / MB],
  ["DOM nodes idle shell", (r) => r.heapIdle.Nodes],
  ["DOM nodes after Library", (r) => r.heapAfterLibrary.Nodes]
];

function delta(a, b) {
  if (a == null || b == null || a === 0) return "—";
  const pct = ((b - a) / Math.abs(a)) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

function buildMarkdown(report) {
  const ids = Object.keys(report.versions);
  const lines = [];
  lines.push(`# Oghma bench — ${report.startedAt.slice(0, 10)}`);
  lines.push("");
  lines.push(`Runs: ${report.runs} · CPU throttle: ${report.cpuThrottle}× · Catalog: ${report.fixtures.primaryNovels} novels (primary site) · Library: ${report.fixtures.libraryBooks} books · Search queries: \`${report.searchQueries.join(", ")}\``);
  lines.push("");
  for (const id of ids) lines.push(`- **${id}** = ${report.versions[id].label} — ${report.versions[id].url}`);
  lines.push("");
  lines.push("## Static assets (dist-bench, vite build --minify)");
  lines.push("");
  const a = (id) => report.versions[id].assets;
  const assetRows = [
    ["JS total raw / gzip / brotli (KB)", (x) => `${fmt(x.js.raw / 1024)} / ${fmt(x.js.gzip / 1024)} / ${fmt(x.js.brotli / 1024)}`],
    ["JS entry raw / gzip / brotli (KB)", (x) => `${fmt(x.entryJs.raw / 1024)} / ${fmt(x.entryJs.gzip / 1024)} / ${fmt(x.entryJs.brotli / 1024)}`],
    ["CSS raw / gzip / brotli (KB)", (x) => `${fmt(x.css.raw / 1024)} / ${fmt(x.css.gzip / 1024)} / ${fmt(x.css.brotli / 1024)}`],
    ["CSS rules total / style rules / selectors", (x) => (x.cssRules ? `${x.cssRules.totalRules} / ${x.cssRules.styleRules} / ${x.cssRules.selectors}` : "—")],
    ["CSS @media / @keyframes / @layer", (x) => (x.cssRules ? `${x.cssRules.mediaRules} / ${x.cssRules.keyframesRules} / ${x.cssRules.layerRules}` : "—")],
    ["CSS declarations", (x) => String(x.cssText.declarations)],
    ["CSS hex colour literals (unique)", (x) => `${x.cssText.hexLiterals} (${x.cssText.uniqueHex})`],
    ["CSS var() refs / custom props defined", (x) => `${x.cssText.varRefs} / ${x.cssText.customPropertyDefs}`],
    ["CSS !important", (x) => String(x.cssText.important)]
  ];
  lines.push(mdTable(["Metric", ...ids], assetRows.map(([label, f]) => [label, ...ids.map((id) => (a(id) ? f(a(id)) : "—"))])));
  lines.push("");
  lines.push("## Runtime (median / p95 over runs)");
  lines.push("");
  const rows = METRICS.map(([label]) => {
    const cells = [label];
    const meds = [];
    for (const id of ids) {
      const s = report.versions[id].summary[label];
      meds.push(s?.median ?? null);
      cells.push(s ? `${fmt(s.median)} / ${fmt(s.p95)}` : "—");
    }
    if (ids.length === 2) cells.push(delta(meds[0], meds[1]));
    return cells;
  });
  lines.push(mdTable(["Metric", ...ids.map((id) => `${id} median / p95`), ...(ids.length === 2 ? ["Δ median"] : [])], rows));
  lines.push("");
  lines.push(`Pooled search keystroke latency (all measured keystrokes): ${ids.map((id) => `${id} p50 ${fmt(report.versions[id].pooledSearch.p50)} ms / p95 ${fmt(report.versions[id].pooledSearch.p95)} ms (n=${report.versions[id].pooledSearch.n})`).join(" · ")}`);
  lines.push("");
  lines.push("## Queue load test (enqueue max, cancel active mid-download)");
  lines.push("");
  const q = (id) => report.versions[id].queue?.result;
  const qRows = [
    ["Books requested / accepted by UI", (id) => `${report.versions[id].queue?.requested ?? "—"} / ${report.versions[id].queue?.accepted ?? "—"}`],
    ["Bundle requests in flight at cancel", (id) => q(id)?.inflightAtCancel],
    ["Cancelled bundle request kept running (finished after cancel)", (id) => q(id)?.bundleRequestKeptRunning],
    ["Cancelled bundle request aborted", (id) => q(id)?.cancelledRequestAborted],
    ["save_export_file invokes after cancel (any book)", (id) => q(id)?.saveInvokesAfterCancel],
    ["save_export_file for the CANCELLED book after cancel", (id) => q(id)?.zombieSavesForCancelledBook],
    ["Next download started after cancel (ms)", (id) => (q(id)?.nextDownloadStartedAfterMs == null ? "—" : Math.round(q(id).nextDownloadStartedAfterMs))],
    ["Max concurrent bundle requests", (id) => q(id)?.maxConcurrentBundleRequests],
    ["Toasts after cancel", (id) => (q(id)?.toastsAfterCancel || []).map((t) => `“${t.slice(0, 60)}”`).join("<br>") || "—"]
  ];
  lines.push(mdTable(["Check", ...ids], qRows.map(([label, f]) => [label, ...ids.map((id) => String(f(id) ?? "—"))])));
  lines.push("");
  lines.push("Notes: times are from the in-page event timestamp to the next animation frame after the DOM matched (MutationObserver). FPS is capped by the headless compositor (~60 Hz) — compare relative values only. TBT = Σ(longtask − 50 ms) in the window.");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const { targets, stop } = await resolveTargets(args);
  const ids = Object.keys(targets);
  const browser = await launchBrowser({ headed: Boolean(args.headed) });
  const report = {
    startedAt: new Date().toISOString(),
    runs: RUNS,
    cpuThrottle: CPU,
    searchQueries: SEARCH_QUERIES,
    node: process.version,
    browser: browser.version(),
    fixtures: {
      primaryNovels: fx.catalogs[fx.manifest.primarySiteId].novels.length,
      totalNovels: Object.values(fx.catalogs).reduce((sum, c) => sum + c.novels.length, 0),
      libraryBooks: fx.library.length,
      catalogBytes: fx.manifest.catalogBytes
    },
    versions: {}
  };
  try {
    const scratch = await browser.newPage();
    for (const id of ids) {
      const version = versions[id];
      const distDir = typeof args[`${id}-dist`] === "string" ? path.resolve(args[`${id}-dist`]) : version.distDir;
      report.versions[id] = {
        label: version.label,
        url: targets[id],
        assets: fs.existsSync(path.join(distDir, "assets")) ? await analyzeDist(distDir, scratch) : null,
        runs: []
      };
    }
    await scratch.close();

    for (let run = 0; run < RUNS; run += 1) {
      const order = run % 2 === 0 ? ids : [...ids].reverse();
      for (const id of order) {
        process.stdout.write(`[run ${run + 1}/${RUNS}] ${id} ... `);
        try {
          const r = await perfRun(browser, versions[id], targets[id], run);
          report.versions[id].runs.push(r);
          console.log(`cards24 ${fmt(r.cold.cards24)}ms · key ${fmt(r.search.keystrokeMedian)}ms · fps ${fmt(r.scroll.fps)} · lib ${fmt(r.library.to24)}ms`);
        } catch (error) {
          console.log(`FAILED: ${error.message}`);
          report.versions[id].runs.push({ run, error: String(error.stack || error) });
        }
      }
    }

    for (const id of ids) {
      const runs = report.versions[id].runs.filter((r) => !r.error);
      const summary = {};
      for (const [label, get] of METRICS) {
        summary[label] = summarize(runs.map((r) => {
          try {
            return get(r);
          } catch {
            return null;
          }
        }));
      }
      report.versions[id].summary = summary;
      const pooled = runs.flatMap((r) => r.search.latencies);
      report.versions[id].pooledSearch = { n: pooled.length, p50: quantile(pooled, 0.5), p95: quantile(pooled, 0.95) };
    }

    if (!args["skip-queue"]) {
      for (const id of ids) {
        process.stdout.write(`[queue] ${id} ... `);
        report.versions[id].queue = await queueTest(browser, versions[id], targets[id]);
        console.log(JSON.stringify(report.versions[id].queue.result ?? report.versions[id].queue.error));
      }
    }
  } finally {
    await browser.close();
    await stop();
  }
  report.finishedAt = new Date().toISOString();
  writeJson(path.join(OUT, "perf.json"), report);
  fs.writeFileSync(path.join(OUT, "perf.md"), buildMarkdown(report));
  console.log(`\nwrote ${path.join(OUT, "perf.json")} and perf.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
