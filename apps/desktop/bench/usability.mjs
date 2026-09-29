#!/usr/bin/env node
// Scripted task paths: counts clicks / keystrokes needed per task and verifies the side-effect.
//
//   node usability.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --out results/<dir>
//   node usability.mjs --serve --out results/<dir>
//
// Every task runs in a fresh context (setup complete, 500-book library). Navigation to the task's
// start view is done by the harness and NOT counted; everything after that is counted through
// lib/actor.mjs. Tasks a version cannot do throw TaskImpossible (recorded as "impossible").
import fs from "node:fs";
import path from "node:path";
import { TaskImpossible, versions } from "./versions.mjs";
import { expectedSearch, loadFixtures } from "./lib/fixtures.mjs";
import { launchBrowser, newBenchContext } from "./lib/context.mjs";
import { makeActor } from "./lib/actor.mjs";
import { mdTable, parseArgs, resolveTargets, sleep, writeJson } from "./lib/common.mjs";
import { sanitizeFileName } from "./fixtures/generate.mjs";

const args = parseArgs();
const OUT = path.resolve(args.out || `results/usability-${new Date().toISOString().slice(0, 10)}`);
const NEW_OUTPUT_PATH = "/Users/bench/Livros Oghma";
const fx = loadFixtures();

// ---------- deterministic targets ----------
function pickTargets() {
  const libraryIds = new Set(fx.library.map((b) => b.novelId));
  const tokens = fx.manifest.searchTokens;
  const primary = fx.catalogs[fx.manifest.primarySiteId].novels;
  let downloadTarget = null;
  for (const token of tokens) {
    const hits = expectedSearch(token);
    if (hits.length === 0 || hits.length > 60) continue;
    const byTitle = new Map(primary.map((n) => [n.title, n]));
    const novel = hits.map((t) => byTitle.get(t)).find((n) => n && n.bundleKey && !libraryIds.has(n.id));
    if (novel) {
      downloadTarget = { query: token, title: novel.title, novelId: novel.id };
      break;
    }
  }
  let libraryTarget = null;
  for (const book of fx.library) {
    const token = tokens.find((t) => book.catalogTitle.toLowerCase().includes(t));
    if (!token || expectedSearch(token).length > 60) continue;
    const libHits = fx.library.filter((b) => b.title.toLowerCase().includes(token));
    libraryTarget = { query: token, title: book.catalogTitle, libraryTitle: book.title, novelId: book.novelId, libraryHits: libHits.length };
    break;
  }
  return { downloadTarget, libraryTarget };
}

const TASKS = [
  { id: "downloadOne", label: "Download one book", start: "discover" },
  { id: "cancelActive", label: "Cancel the active download", start: "discover", bundleDelayMs: 60000 },
  { id: "redownload", label: "Re-download a book already in the library", start: "library" },
  { id: "sendToKindle", label: "Send a library book to Kindle", start: "library", kindle: true },
  { id: "changeOutputFolder", label: "Change the output folder", start: "discover" }
];

async function waitFor(fn, timeoutMs = 20000, interval = 100) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

async function runTask(browser, version, url, task, targets) {
  const { context, routes } = await newBenchContext(browser, {
    version,
    kindle: Boolean(task.kindle),
    bundleDelayMs: task.bundleDelayMs ?? 0,
    dialogPath: NEW_OUTPUT_PATH
  });
  const page = await context.newPage();
  const record = { task: task.id, label: task.label, start: task.start, version: version.id };
  try {
    await page.goto(url);
    await version.waitShell(page);
    await version.waitDiscoverCards(page, 24);
    // ---- preconditions (not counted) ----
    if (task.id === "cancelActive") {
      await version.enqueueMany(page, 1);
      await waitFor(() => routes.state.bundleEvents.some((e) => e.phase === "request"), 15000);
    }
    if (task.kindle) {
      const ok = await page.locator(version.sel.kindleConnected).first().waitFor({ state: "visible", timeout: 12000 }).then(() => true, () => false);
      record.kindleDetected = ok;
    }
    if (task.start !== "discover") await version.goto(page, task.start);
    await sleep(300);

    const act = makeActor(page);
    const started = Date.now();
    const target = task.id === "downloadOne" ? targets.downloadTarget : targets.libraryTarget;
    const taskFn = version.tasks?.[task.id];
    if (!taskFn) throw new TaskImpossible("no path defined for this version");
    const info = await taskFn({
      page,
      act,
      target: task.id === "sendToKindle" ? { ...target, title: target.libraryTitle } : target,
      newPath: NEW_OUTPUT_PATH
    });

    // ---- verify side-effect ----
    let verified = false;
    let evidence = null;
    if (task.id === "downloadOne" || task.id === "redownload") {
      const dirName = sanitizeFileName(target.title);
      evidence = await waitFor(() => page.evaluate((d) => window.__BENCH__.saves.find((s) => s.dir.endsWith(`/${d}`) && /\.epub$/i.test(s.name)), dirName));
      verified = Boolean(evidence);
    } else if (task.id === "cancelActive") {
      const title = info;
      await sleep(500);
      const stillActive = await page.locator(version.sel.downloadActiveRow).filter({ hasText: title || "__none__" }).count();
      verified = Boolean(title) && stillActive === 0;
      evidence = { cancelledTitle: title };
    } else if (task.id === "sendToKindle") {
      // The new UI names books by their catalog title (matched by novel id); v1 uses the folder name.
      const titles = [target.libraryTitle, target.title];
      evidence = await waitFor(() => page.evaluate((ts) => window.__BENCH__.kindleSends.find((s) => s.items.some((i) => ts.includes(i.title))), titles));
      verified = Boolean(evidence);
    } else if (task.id === "changeOutputFolder") {
      evidence = await waitFor(() => page.evaluate(() => {
        try {
          return JSON.parse(localStorage.getItem("oghma.setup.v1") || "{}").outputPath;
        } catch {
          return null;
        }
      }).then((value) => (value === NEW_OUTPUT_PATH ? value : null)), 5000);
      verified = Boolean(evidence);
    }
    Object.assign(record, {
      status: verified ? "ok" : "unverified",
      clicks: act.counts.clicks,
      keystrokes: act.counts.keystrokes,
      interactions: act.counts.clicks + act.counts.keystrokes,
      ms: Date.now() - started,
      steps: act.steps,
      note: typeof info === "object" && info?.note ? info.note : undefined,
      evidence: evidence && typeof evidence === "object" ? { ...evidence, items: undefined } : evidence
    });
  } catch (error) {
    if (error instanceof TaskImpossible) Object.assign(record, { status: "impossible", reason: error.message });
    else Object.assign(record, { status: "error", reason: String(error.message || error).split("\n")[0] });
  } finally {
    await context.close();
  }
  return record;
}

function buildMarkdown(report) {
  const ids = Object.keys(report.versions);
  const cell = (r) => {
    if (!r) return "—";
    if (r.status === "impossible") return `impossible (${r.reason})`;
    if (r.status === "error") return `error: ${r.reason}`;
    return `${r.clicks} clicks + ${r.keystrokes} keys = **${r.interactions}**${r.status !== "ok" ? " (unverified)" : ""}`;
  };
  const lines = [
    `# Oghma usability — ${report.generatedAt.slice(0, 10)}`,
    "",
    ids.map((id) => `- **${id}** = ${report.versions[id].label} — ${report.versions[id].url}`).join("\n"),
    "",
    `Targets: download \`${report.targets.downloadTarget?.title}\` (query \`${report.targets.downloadTarget?.query}\`); library book \`${report.targets.libraryTarget?.title}\` (query \`${report.targets.libraryTarget?.query}\`). New output folder: \`${NEW_OUTPUT_PATH}\`.`,
    "",
    "Counting starts in the listed start view; keystrokes include typed search/path text (identical across versions) and shortcuts.",
    "",
    mdTable(["Task", "Start", ...ids], TASKS.map((t) => [t.label, t.start, ...ids.map((id) => cell(report.versions[id].tasks.find((r) => r.task === t.id)))])),
    ""
  ];
  const notes = [];
  for (const id of ids) {
    for (const r of report.versions[id].tasks) {
      if (r.note) notes.push(`- ${id} / ${r.label}: ${r.note}`);
      if (r.kindleDetected === false) notes.push(`- ${id} / ${r.label}: Kindle indicator never showed as connected`);
    }
  }
  if (notes.length) lines.push("## Notes", "", ...notes, "");
  lines.push("## Step logs", "");
  for (const id of ids) {
    for (const r of report.versions[id].tasks) {
      lines.push(`- **${id} · ${r.label}** (${r.status}, ${r.ms ?? "—"} ms): ${(r.steps || []).map((s) => (s.kind === "type" ? `type “${s.text}”` : s.kind === "key" ? `key ${s.key}` : `${s.kind} ${s.target.replace(/\|/g, "\\|").slice(0, 70)}`)).join(" → ")}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const targets = pickTargets();
  if (!targets.downloadTarget || !targets.libraryTarget) throw new Error(`Could not pick targets: ${JSON.stringify(targets)}`);
  const { targets: urls, stop } = await resolveTargets(args);
  const browser = await launchBrowser({ headed: Boolean(args.headed) });
  const report = { generatedAt: new Date().toISOString(), targets, versions: {} };
  try {
    for (const id of Object.keys(urls)) {
      report.versions[id] = { label: versions[id].label, url: urls[id], tasks: [] };
      for (const task of TASKS) {
        process.stdout.write(`[usability] ${id} ${task.id} ... `);
        const r = await runTask(browser, versions[id], urls[id], task, targets);
        report.versions[id].tasks.push(r);
        console.log(r.status === "ok" ? `${r.clicks} clicks + ${r.keystrokes} keys` : `${r.status}${r.reason ? `: ${r.reason}` : ""}`);
      }
    }
  } finally {
    await browser.close();
    await stop();
  }
  writeJson(path.join(OUT, "usability.json"), report);
  fs.writeFileSync(path.join(OUT, "usability.md"), buildMarkdown(report));
  console.log(`wrote ${path.join(OUT, "usability.md")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
