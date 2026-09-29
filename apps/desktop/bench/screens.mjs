#!/usr/bin/env node
// Visual comparison: screenshots of the main screens for each version + side-by-side gallery.
//
//   node screens.mjs --old http://127.0.0.1:4174 --new http://127.0.0.1:4173 --out results/<dir>/screens
//   node screens.mjs --serve --out results/<dir>/screens [--platform macos] [--format png|jpeg|auto]
//
// Viewports: 1280x800 and 1120x720 at deviceScaleFactor 2 (override with --viewports 1280x800,1440x900 --dpr 1).
// --format auto (default): PNG unless the whole set exceeds --max-mb (25), then JPEG quality 80.
import fs from "node:fs";
import path from "node:path";
import { versions } from "./versions.mjs";
import { launchBrowser, newBenchContext } from "./lib/context.mjs";
import { parseArgs, resolveTargets, sleep, writeJson } from "./lib/common.mjs";

const args = parseArgs();
const OUT = path.resolve(args.out || `results/screens-${new Date().toISOString().slice(0, 10)}`);
const PLATFORM = typeof args.platform === "string" ? args.platform : "windows";
const DPR = Number(args.dpr || 2);
const FORMAT = typeof args.format === "string" ? args.format : "auto";
const MAX_BYTES = Number(args["max-mb"] || 25) * 1024 * 1024;
const VIEWPORTS = String(args.viewports || "1280x800,1120x720")
  .split(",")
  .map((v) => {
    const [width, height] = v.split("x").map(Number);
    return { width, height, key: `${width}x${height}` };
  });

export const SHOTS = [
  { id: "discover", label: "Discover" },
  { id: "discover-detail", label: "Discover + detail/preview" },
  { id: "downloads", label: "Downloads (active + queued)" },
  { id: "library", label: "Library (500 books)" },
  { id: "library-detail", label: "Library details" },
  { id: "settings", label: "Settings" },
  { id: "onboarding", label: "Onboarding — first step" },
  { id: "titlebar", label: "Titlebar area" }
];

async function waitToastsGone(page, version, timeout = 4500) {
  await page
    .waitForFunction((sel) => !Array.from(document.querySelectorAll(sel)).some((el) => (el.textContent || "").trim()), version.toastSelector, { timeout })
    .catch(() => undefined);
}

async function settle(page, version) {
  await waitToastsGone(page, version);
  await page.evaluate(() => document.fonts && document.fonts.ready);
  // let background-image covers decode
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(250);
}

async function capture(page, shots, key, options = {}) {
  const common = { animations: "disabled", caret: "hide", scale: "device", ...options };
  const png = FORMAT === "jpeg" ? null : await page.screenshot({ ...common, type: "png" });
  const jpeg = FORMAT === "png" ? null : await page.screenshot({ ...common, type: "jpeg", quality: 80 });
  shots[key] = { png, jpeg };
}

async function shootVersion(browser, version, url, viewport) {
  const shots = {};
  const notes = {};
  const base = { version, viewport, deviceScaleFactor: DPR, platform: PLATFORM };

  // ---- main context: setup complete, 500-book library ----
  {
    const { context, routes } = await newBenchContext(browser, { ...base, bundleDelayMs: 0 });
    const page = await context.newPage();
    await page.goto(url);
    await version.waitShell(page);
    await version.waitDiscoverCards(page, 24);
    await settle(page, version);
    await capture(page, shots, "discover");

    const titlebar = page.locator(version.sel.titlebar).first();
    const box = (await titlebar.count()) ? await titlebar.boundingBox() : null;
    const height = Math.min(viewport.height, Math.max(48, Math.ceil((box ? box.y + box.height : 40) + 12)));
    await capture(page, shots, "titlebar", { clip: { x: 0, y: 0, width: viewport.width, height } });

    try {
      await version.openDiscoverDetail(page);
      await settle(page, version);
      await capture(page, shots, "discover-detail");
    } catch (error) {
      notes["discover-detail"] = String(error.message || error).split("\n")[0];
    }
    await page.keyboard.press("Escape");

    try {
      await version.goto(page, "library");
      await page.locator(version.sel.libraryCard).first().waitFor({ state: "visible" });
      await settle(page, version);
      await capture(page, shots, "library");
      await version.openLibraryDetail(page);
      await settle(page, version);
      await capture(page, shots, "library-detail");
    } catch (error) {
      notes.library = String(error.message || error).split("\n")[0];
    }

    try {
      await version.goto(page, "settings");
      await settle(page, version);
      await capture(page, shots, "settings");
    } catch (error) {
      notes.settings = String(error.message || error).split("\n")[0];
    }

    try {
      routes.setBundleDelay(10 * 60 * 1000); // downloads never finish while we look at them
      await version.goto(page, "discover");
      await version.waitDiscoverCards(page, 24);
      await version.enqueueMany(page, 4);
      await version.goto(page, "downloads");
      await page.locator(version.sel.downloadActiveRow).first().waitFor({ state: "visible", timeout: 15000 });
      await settle(page, version);
      await capture(page, shots, "downloads");
    } catch (error) {
      notes.downloads = String(error.message || error).split("\n")[0];
    }
    await context.close();
  }

  // ---- onboarding: setup NOT completed ----
  {
    const { context } = await newBenchContext(browser, { ...base, setup: "fresh" });
    const page = await context.newPage();
    try {
      await page.goto(url);
      await page.locator(version.sel.onboardingDialog).first().waitFor({ state: "visible", timeout: 20000 });
      if (version.sel.splash) await page.locator(version.sel.splash).waitFor({ state: "detached", timeout: 20000 });
      await settle(page, version);
      await capture(page, shots, "onboarding");
    } catch (error) {
      notes.onboarding = String(error.message || error).split("\n")[0];
    }
    await context.close();
  }
  return { shots, notes };
}

function galleryHtml(manifest) {
  const ids = manifest.versions.map((v) => v.id);
  const rows = [];
  for (const viewport of manifest.viewports) {
    rows.push(`<h2>${viewport} @${manifest.dpr}x · platform: ${manifest.platform}</h2>`);
    for (const shot of SHOTS) {
      const cells = ids
        .map((id) => {
          const file = manifest.files[id]?.[viewport]?.[shot.id];
          const note = manifest.notes[id]?.[viewport]?.[shot.id];
          return `<figure><figcaption>${id} — ${manifest.versions.find((v) => v.id === id).label}</figcaption>${
            file ? `<a href="${file}"><img loading="lazy" src="${file}" alt="${id} ${shot.id}"></a>` : `<div class="missing">not captured${note ? `: ${note.replace(/</g, "&lt;")}` : ""}</div>`
          }</figure>`;
        })
        .join("");
      rows.push(`<section><h3>${shot.label}</h3><div class="pair">${cells}</div></section>`);
    }
  }
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Oghma screens</title>
<style>
:root { color-scheme: light dark; --bg: #f6f6f4; --fg: #1d1d1b; --muted: #6b6b66; --card: #fff; --line: #ddd; }
@media (prefers-color-scheme: dark) { :root { --bg: #151514; --fg: #ecebe6; --muted: #9a9993; --card: #1f1f1d; --line: #333; } }
body { margin: 0; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { margin: 28px 0 8px; font-size: 16px; } h3 { margin: 16px 0 6px; font-size: 14px; color: var(--muted); }
.pair { display: grid; grid-template-columns: repeat(${ids.length}, minmax(0, 1fr)); gap: 12px; }
figure { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px; }
figcaption { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
img { width: 100%; height: auto; display: block; border-radius: 4px; }
.missing { padding: 24px; color: var(--muted); font-style: italic; }
@media (max-width: 700px) { .pair { grid-template-columns: 1fr; } }
</style></head><body>
<h1>Oghma Library — side by side</h1>
<p>${manifest.generatedAt} · ${ids.map((id) => `${id} = ${manifest.versions.find((v) => v.id === id).label} (${manifest.versions.find((v) => v.id === id).url})`).join(" · ")} · format ${manifest.format}</p>
${rows.join("\n")}
</body></html>
`;
}

async function main() {
  const { targets, stop } = await resolveTargets(args);
  const browser = await launchBrowser({ headed: Boolean(args.headed) });
  const collected = {};
  const notes = {};
  try {
    for (const id of Object.keys(targets)) {
      collected[id] = {};
      notes[id] = {};
      for (const viewport of VIEWPORTS) {
        process.stdout.write(`[screens] ${id} ${viewport.key} ... `);
        const r = await shootVersion(browser, versions[id], targets[id], viewport);
        collected[id][viewport.key] = r.shots;
        notes[id][viewport.key] = r.notes;
        console.log(`${Object.keys(r.shots).length} shots${Object.keys(r.notes).length ? ` (issues: ${JSON.stringify(r.notes)})` : ""}`);
      }
    }
  } finally {
    await browser.close();
    await stop();
  }

  let pngBytes = 0;
  for (const byVp of Object.values(collected)) for (const shots of Object.values(byVp)) for (const s of Object.values(shots)) pngBytes += s.png?.length ?? 0;
  const format = FORMAT === "auto" ? (pngBytes > MAX_BYTES ? "jpeg" : "png") : FORMAT;
  const ext = format === "jpeg" ? "jpg" : "png";
  const files = {};
  let written = 0;
  for (const [id, byVp] of Object.entries(collected)) {
    files[id] = {};
    for (const [vp, shots] of Object.entries(byVp)) {
      files[id][vp] = {};
      for (const [shot, bufs] of Object.entries(shots)) {
        const rel = `${id}/${vp}/${shot}.${ext}`;
        const buf = format === "jpeg" ? bufs.jpeg : bufs.png;
        fs.mkdirSync(path.join(OUT, id, vp), { recursive: true });
        fs.writeFileSync(path.join(OUT, rel), buf);
        written += buf.length;
        files[id][vp][shot] = rel;
      }
    }
  }
  const manifest = {
    generatedAt: new Date().toISOString(),
    platform: PLATFORM,
    dpr: DPR,
    viewports: VIEWPORTS.map((v) => v.key),
    format,
    pngBytes,
    writtenBytes: written,
    versions: Object.keys(targets).map((id) => ({ id, label: versions[id].label, url: targets[id] })),
    files,
    notes
  };
  writeJson(path.join(OUT, "screens.json"), manifest);
  fs.writeFileSync(path.join(OUT, "index.html"), galleryHtml(manifest));
  console.log(`wrote ${Object.values(files).reduce((n, v) => n + Object.values(v).reduce((m, s) => m + Object.keys(s).length, 0), 0)} ${format.toUpperCase()} (${(written / 1024 / 1024).toFixed(1)} MB; PNG set would be ${(pngBytes / 1024 / 1024).toFixed(1)} MB) -> ${OUT}/index.html`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
