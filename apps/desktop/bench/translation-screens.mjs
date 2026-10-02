#!/usr/bin/env node
// Screenshots of the Translation screen (WebKit, macOS UA) over the fake engine in translation-shim.js.
//
//   npx vite build --outDir dist-bench && npx vite preview --outDir dist-bench --port 5311 &
//   node bench/translation-screens.mjs --url http://127.0.0.1:5311 --out bench/tmp/translation
//
// Options: --viewports 1120x720,1440x900  --dpr 2  --headed
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, newBenchContext } from "./lib/context.mjs";
import { parseArgs, sleep } from "./lib/common.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs();
const URL_BASE = typeof args.url === "string" ? args.url : "http://127.0.0.1:5311";
const OUT = path.resolve(typeof args.out === "string" ? args.out : path.join(here, "tmp", "translation"));
const DPR = Number(args.dpr || 2);
const VIEWPORTS = String(args.viewports || "1120x720,1440x900").split(",").map((v) => {
  const [width, height] = v.split("x").map(Number);
  return { width, height, key: `${width}x${height}` };
});

async function settle(page) {
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(350);
}

async function shot(page, name) {
  await settle(page);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  console.log("saved", path.relative(process.cwd(), file));
}

async function openTranslation(browser, viewport, translation = {}) {
  const { context } = await newBenchContext(browser, { platform: "macos", viewport, deviceScaleFactor: DPR, libraryCount: 24 });
  await context.addInitScript({ content: `window.__BENCH_TRANSLATION__ = ${JSON.stringify(translation)};` });
  await context.addInitScript({ path: path.join(here, "translation-shim.js") });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  await page.goto(URL_BASE);
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".o-splash"), null, { timeout: 30000 }).catch(() => undefined);
  await page.click('[data-testid="nav-translation"]');
  await page.waitForSelector('[data-testid="translation-workspace"] [data-testid="translation-progress"]', { timeout: 15000 });
  return { context, page };
}

async function tab(page, name) {
  await page.getByRole("radio", { name, exact: true }).click();
  await sleep(200);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser({ engine: "webkit", headed: Boolean(args.headed) });
  try {
    for (const viewport of VIEWPORTS) {
      const k = viewport.key;
      {
        const { context, page } = await openTranslation(browser, viewport);
        await shot(page, `${k}-1-progress-running`);
        await tab(page, "Piloto");
        await page.waitForSelector('[data-testid="pilot-table"]');
        await shot(page, `${k}-2-pilot`);
        await page.getByRole("radio", { name: "Qualidade", exact: true }).click();
        await shot(page, `${k}-2b-pilot-quality`);
        await tab(page, "Glossário");
        await page.waitForSelector('[data-testid="glossary-row"]');
        await shot(page, `${k}-3-glossary`);
        await page.getByRole("button", { name: "Editar Tidewardens" }).click();
        await shot(page, `${k}-3b-glossary-edit`);
        await tab(page, "Revisar");
        await page.waitForSelector('[data-testid="review-reader"]');
        await shot(page, `${k}-4-review`);
        await tab(page, "Progresso");
        await page.locator('[data-testid="translation-project"][data-status="waiting_limit"]').click();
        await page.waitForSelector('[data-testid="translation-banner"][data-kind="waiting"]');
        await shot(page, `${k}-5-waiting-limit`);
        await page.locator('[data-testid="translation-project"][data-status="exported"]').click();
        await page.waitForSelector('[data-testid="translation-banner"][data-kind="exported"]');
        await shot(page, `${k}-6-exported`);
        await page.getByRole("button", { name: "Traduzir livro" }).first().click();
        await page.waitForSelector('[data-testid="translation-picker-book"]');
        await page.locator('[data-testid="translation-picker-book"]:not([disabled])').nth(1).click();
        await shot(page, `${k}-7-picker`);
        await context.close();
      }
      {
        const { context, page } = await openTranslation(browser, viewport, { limit: true });
        await page.locator('[data-testid="translation-project"][data-status="waiting_limit"]').click();
        await page.waitForSelector('[data-testid="translation-banner"][data-kind="waiting"]');
        await shot(page, `${k}-8-limit-reached`);
        await context.close();
      }
      {
        const { context, page } = await openTranslation(browser, viewport, { loggedIn: false });
        await shot(page, `${k}-9-logged-out`);
        await page.getByRole("button", { name: "Conectar ChatGPT" }).click();
        await shot(page, `${k}-9b-connecting`);
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
