#!/usr/bin/env node
// Screenshots of the library (status, ratings, shelf) and the Oghma account (sheet, profile,
// settings, sidebar) in WebKit with a macOS UA. The account API is faked in the page.
//
//   npx vite build --outDir dist-bench && npx vite preview --outDir dist-bench --port 5311 &
//   node bench/library-account-screens.mjs --url http://127.0.0.1:5311 --out bench/tmp/library-account
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { launchBrowser, newBenchContext } from "./lib/context.mjs";
import { parseArgs, sleep } from "./lib/common.mjs";
import { loadFixtures } from "./lib/fixtures.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = parseArgs();
const URL_BASE = typeof args.url === "string" ? args.url : "http://127.0.0.1:5311";
const OUT = path.resolve(typeof args.out === "string" ? args.out : path.join(here, "tmp", "library-account"));
const viewport = { width: 1280, height: 800 };

/** Library rows (status, rating, favorite) for the downloaded books and a few shelf-only ones. */
function seedMeta() {
  const fx = loadFixtures();
  const novels = fx.catalogs["acervo-alfa"].novels;
  const meta = {};
  const statuses = ["reading", "completed", "paused", "completed", "dropped", "reading", "unread", "completed"];
  fx.library.slice(0, 8).forEach((book, index) => {
    meta[`novel:${book.novelId}`] = {
      key: `novel:${book.novelId}`,
      favorite: index % 3 === 0,
      readingStatus: statuses[index],
      tags: [],
      hidden: false,
      rating: [4, 5, null, 3, 1, null, null, 5][index],
      onShelf: true,
      addedAt: Date.now() - index * 86_400_000,
      changedAt: Date.now()
    };
  });
  [300, 301, 302, 303].forEach((at, index) => {
    const novel = novels[at];
    meta[`novel:${novel.id}`] = {
      key: `novel:${novel.id}`,
      favorite: index === 0,
      readingStatus: ["completed", "completed", "unread", "completed"][index],
      tags: [],
      hidden: false,
      rating: [5, 4, null, 2][index],
      onShelf: true,
      addedAt: Date.now() - (20 + index) * 86_400_000,
      changedAt: Date.now(),
      snapshot: { novelId: novel.id, title: novel.title, author: novel.author, sourceName: "Acervo Alfa" }
    };
  });
  // A book whose source left the catalog.
  meta["novel:lunar:o-ultimo-guardiao"] = {
    key: "novel:lunar:o-ultimo-guardiao",
    favorite: false,
    readingStatus: "paused",
    tags: [],
    hidden: false,
    rating: 4,
    onShelf: true,
    addedAt: Date.now() - 40 * 86_400_000,
    changedAt: Date.now(),
    snapshot: { novelId: "lunar:o-ultimo-guardiao", title: novels[310].title, author: "Autor Antigo", sourceName: "NovelLunar" }
  };
  return meta;
}

const accountShim = (signedIn, meta) => `(() => {
  const B = window.__BENCH__;
  if (!B || !B.handlers) return;
  Object.assign(B.meta, ${JSON.stringify(meta)});
  let signedIn = ${signedIn ? "true" : "false"};
  let user = {
    publicId: "pub-bench", email: "jandson@exemplo.com", nickname: ${signedIn ? '"jandson"' : "null"},
    avatarId: ${signedIn ? '"sung-jinwoo"' : "null"}, avatarColor: null,
    createdAt: "2026-10-04T12:00:00Z", needsProfile: ${signedIn ? "false" : "true"}
  };
  const ok = (body, status = 200) => ({ status, body });
  Object.assign(B.handlers, {
    library_sync_pending: () => [],
    library_sync_mark_clean: () => 0,
    library_sync_apply: () => 0,
    library_sync_mark_all_dirty: () => 0,
    oghma_account_status: () => ({ signedIn, baseUrl: "https://conta.oghma.dev" }),
    oghma_account_request_code: (a) => ok({ email: a.email, resendIn: 60 }, 202),
    oghma_account_verify: () => { signedIn = true; return ok({ user, created: true }); },
    oghma_account_logout: () => { signedIn = false; return null; },
    oghma_account_forget: () => null,
    oghma_account_api: (a) => {
      const p = a.path;
      if (p.startsWith("/v1/nicknames/")) {
        const n = decodeURIComponent(p.split("/")[3]).toLowerCase();
        return ok(n === "jandson" ? { available: false, reason: "taken", suggestions: ["jandson_br", "jandson.livros", "jandson2"] } : { available: true, reason: null, suggestions: [] });
      }
      if (p === "/v1/me" && a.method === "PATCH") { user = { ...user, ...a.body, needsProfile: false }; return ok(user); }
      if (p === "/v1/me") return ok(user);
      if (p === "/v1/me/sessions") return ok({ sessions: [
        { id: 1, deviceName: "MacBook Pro de Jandson", platform: "macos", createdAt: "2026-10-04T12:00:00Z", lastSeenAt: new Date().toISOString(), current: true },
        { id: 2, deviceName: "DESKTOP-JANDSON", platform: "windows", createdAt: "2026-10-01T12:00:00Z", lastSeenAt: new Date(Date.now() - 2 * 86400000).toISOString(), current: false }
      ] });
      if (p.startsWith("/v1/me/library?")) return ok({ entries: [], cursor: 12, more: false });
      if (p === "/v1/me/library/changes") return ok({ accepted: [], rejected: [], cursor: 12 });
      return ok({});
    }
  });
})();`;

async function shot(page, name) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await sleep(500);
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", caret: "hide" });
  console.log("saved", path.relative(process.cwd(), file));
}

async function open(browser, { signedIn }) {
  const { context } = await newBenchContext(browser, { platform: "macos", viewport, deviceScaleFactor: 2, libraryCount: 8 });
  await context.addInitScript({ content: accountShim(signedIn, seedMeta()) });
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
      const { context, page } = await open(browser, { signedIn: true });
      await page.click('[data-testid="nav-library"]');
      await page.waitForSelector('[data-testid="library-card"]');
      await sleep(800);
      await shot(page, "01-library-grid");
      await page.locator('[data-testid="library-card"]').nth(2).hover();
      await shot(page, "02-library-hover-rating");
      await page.locator('[data-testid="library-status-filters"] button', { hasText: "Na estante" }).click();
      await shot(page, "03-library-shelf-filter");
      await page.locator('[data-testid="library-status-filters"] button', { hasText: "Todos" }).click();
      await page.getByRole("radio", { name: "Lista" }).click().catch(async () => {
        await page.locator('[aria-label="Visualização"] button').nth(1).click();
      });
      await shot(page, "04-library-list");
      await page.locator('[aria-label="Visualização"] button').nth(0).click().catch(() => undefined);
      await page.locator('[data-testid="library-card"]').first().click({ button: "right" });
      await shot(page, "05-library-context-menu");
      await page.keyboard.press("Escape");
      // A shelf book whose source left the catalog.
      await page.locator('[data-testid="library-card"].is-unavailable [data-testid="card-title"]').first().click();
      await page.waitForSelector('[data-testid="library-detail"]');
      await shot(page, "06-details-unavailable");
      await page.click('[data-testid="library-find-edition"]').catch(() => undefined);
      await shot(page, "07-editions-dialog");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      await page.locator('[data-testid="library-card"]').nth(1).locator('[data-testid="card-title"]').click();
      await page.waitForSelector('[data-testid="library-detail"]');
      await shot(page, "08-details-local");

      await page.click('[data-testid="nav-discover"]');
      await page.waitForSelector('[data-testid="book-card"]');
      await page.locator('[data-testid="book-card"]').nth(20).click();
      await page.waitForSelector('[data-testid="discover-shelf"]');
      await shot(page, "09-discover-add-shelf");
      await page.click('[data-testid="discover-already-read"]');
      await shot(page, "10-discover-already-read");

      await page.click('[data-testid="nav-settings"]');
      await page.getByRole("tab", { name: /Conta/ }).click();
      await page.waitForSelector('[data-testid="oghma-account"]');
      await shot(page, "11-settings-account");
      await page.click('[data-testid="sidebar-account"]');
      await shot(page, "12-sidebar-menu");
      await page.keyboard.press("Escape");
      await page.click('[data-testid="oghma-account-edit"]');
      await page.waitForSelector(".profile-editor");
      await shot(page, "13-edit-profile");
      await page.keyboard.press("Escape");

      await page.click('[data-testid="nav-home"]');
      await sleep(800);
      await shot(page, "14-home");
      await context.close();
    }
    {
      const { context, page } = await open(browser, { signedIn: false });
      await page.click('[data-testid="nav-settings"]');
      await page.getByRole("tab", { name: /Conta/ }).click();
      await page.waitForSelector('[data-testid="oghma-account-signed-out"]');
      await shot(page, "15-settings-signed-out");
      await page.click('[data-testid="sidebar-account-sign-in"]');
      await page.fill('[data-testid="account-email"]', "jandson@exemplo.com");
      await shot(page, "16-sheet-email");
      await page.click('[data-testid="account-continue"]');
      await page.waitForSelector(".o-code");
      await page.keyboard.type("12");
      await shot(page, "17-sheet-code");
      await page.keyboard.type("3456");
      await page.waitForSelector(".profile-editor");
      await shot(page, "18-sheet-profile");
      await page.fill('[data-testid="profile-nickname"]', "Jandson");
      await sleep(900);
      await shot(page, "19-sheet-nickname-taken");
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
