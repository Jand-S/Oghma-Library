#!/usr/bin/env node
// Screenshots of the Mac integrations (Kindle Wi-Fi/cable, iCloud) in WebKit with a macOS UA.
//
//   npx vite build --outDir dist-bench && npx vite preview --outDir dist-bench --port 5311 &
//   node bench/integrations-screens.mjs --url http://127.0.0.1:5311 --out bench/tmp/integrations
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, newBenchContext } from "./lib/context.mjs";
import { parseArgs, sleep } from "./lib/common.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs();
const URL_BASE = typeof args.url === "string" ? args.url : "http://127.0.0.1:5311";
const OUT = path.resolve(typeof args.out === "string" ? args.out : path.join(here, "tmp", "integrations"));
const viewport = { width: 1120, height: 720 };

async function shot(page, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(400);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  console.log("saved", path.relative(process.cwd(), file));
}

async function open(browser, opts) {
  const { context } = await newBenchContext(browser, { platform: "macos", viewport, deviceScaleFactor: 2, libraryCount: 8, ...opts });
  const page = await context.newPage();
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  await page.goto(URL_BASE);
  await page.waitForSelector('[data-testid="app-shell"]', { timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector(".o-splash"), null, { timeout: 30000 }).catch(() => undefined);
  return { context, page };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await launchBrowser({ engine: "webkit", headed: Boolean(args.headed) });
  try {
    {
      const { context, page } = await open(browser, { kindle: false });
      await page.click('[data-testid="nav-library"]');
      await page.waitForSelector('[data-testid="library-card"]');
      await page.locator('[data-testid="library-card"] [data-testid="card-title"]').first().click();
      await page.waitForSelector('[data-testid="library-kindle-menu"]');
      await shot(page, "1-details");
      await page.click('[data-testid="library-kindle-menu"]');
      await shot(page, "2-details-kindle-menu");
      await page.keyboard.press("Escape");
      await page.click('[data-testid="library-icloud"]');
      await shot(page, "3-icloud-toast");
      await page.click('[data-testid="nav-kindle"]');
      await page.waitForSelector('[data-testid="kindle-hero"]');
      await page.locator('[data-testid="kindle-book"]').first().click();
      await shot(page, "4-kindle-wifi");
      await page.click('[data-testid="nav-settings"]');
      await page.getByRole("tab", { name: /Kindle/ }).click();
      await shot(page, "5-settings");
      await page.mouse.wheel(0, 900);
      await shot(page, "6-settings-icloud");
      await context.close();
    }
    {
      const { context, page } = await open(browser, { kindle: true });
      await page.click('[data-testid="nav-kindle"]');
      await page.waitForSelector('[data-testid="kindle-connected"]');
      await shot(page, "7-kindle-cable");
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
