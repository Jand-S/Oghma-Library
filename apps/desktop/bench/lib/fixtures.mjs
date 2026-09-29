// Loads the generated fixtures and serves them to the app via Playwright routing.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BENCH_DIR = path.resolve(here, "..");
export const FIXTURES_DIR = path.join(BENCH_DIR, "fixtures", "out");

// Hosts the app may try to reach. The default serverUrl in core/appConfig.ts is https://b2.jandson.me;
// seeded configs point at it too, so onboarding ("fresh") and seeded runs hit the same routes.
export const FIXTURE_HOSTS = ["b2.jandson.me", "fixtures.bench.invalid"];
export const FIXTURE_SERVER_URL = "https://b2.jandson.me";

export function ensureFixtures() {
  if (!fs.existsSync(path.join(FIXTURES_DIR, "manifest.json"))) {
    execFileSync(process.execPath, [path.join(BENCH_DIR, "fixtures", "generate.mjs")], { stdio: "inherit" });
  }
}

let cached = null;
export function loadFixtures() {
  if (cached) return cached;
  ensureFixtures();
  const read = (rel) => fs.readFileSync(path.join(FIXTURES_DIR, rel));
  const manifest = JSON.parse(read("manifest.json"));
  const index = JSON.parse(read("index.json"));
  const catalogs = {};
  for (const site of index.sites) catalogs[site.id] = JSON.parse(zlib.gunzipSync(read(site.catalogJsonKey)).toString("utf8"));
  const library = JSON.parse(read("library.json"));
  const coverDataUrls = [];
  for (let i = 0; i < manifest.coverCount; i += 1) {
    coverDataUrls.push(`data:image/png;base64,${read(`covers/c${String(i).padStart(2, "0")}.png`).toString("base64")}`);
  }
  cached = { manifest, index, catalogs, library, coverDataUrls, read };
  return cached;
}

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  return hash;
}

// unref'd so long artificial delays never keep the Node process alive after a context closes.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms).unref());

/**
 * Route fixture hosts on a BrowserContext.
 * Returns a controller: { setBundleDelay(ms), bundleEvents, blocked, served }.
 * bundleEvents: [{ url, slug, phase: 'request'|'fulfilled'|'finished'|'failed', t (Date.now()), failure? }]
 */
export async function routeFixtures(context, { bundleDelayMs = 0, catalogDelayMs = 0, blockExternal = true } = {}) {
  const fx = loadFixtures();
  const state = { bundleDelayMs, catalogDelayMs, bundleEvents: [], blocked: [], served: 0 };

  if (blockExternal) {
    // Registered first => lowest priority (Playwright runs the most recently registered route first).
    await context.route(/^https?:\/\//, async (route) => {
      const url = route.request().url();
      const host = new URL(url).hostname;
      if (host === "127.0.0.1" || host === "localhost") return route.continue();
      state.blocked.push(url);
      return route.abort("blockedbyclient");
    });
  }

  const hostPattern = new RegExp(`^https?://(${FIXTURE_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})/`);
  await context.route(hostPattern, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const rel = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "cache-control": "no-store"
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    try {
      if (rel === "index.json") {
        state.served += 1;
        return await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/json" }, body: fx.read("index.json") });
      }
      if (rel.startsWith("catalog/") && rel.endsWith(".json.gz")) {
        if (state.catalogDelayMs) await sleep(state.catalogDelayMs);
        state.served += 1;
        return await route.fulfill({ status: 200, headers: { ...cors, "content-type": "application/octet-stream" }, body: fx.read(rel) });
      }
      if (rel.startsWith("covers/") && rel.endsWith(".png")) {
        state.served += 1;
        return await route.fulfill({ status: 200, headers: { ...cors, "content-type": "image/png" }, body: fx.read(rel) });
      }
      if (rel.startsWith("content/") && rel.endsWith(".tar.gz")) {
        const slug = rel.split("/")[2] || rel;
        const variant = hashString(slug) % fx.manifest.bundleVariants.length;
        const delay = state.bundleDelayMs;
        state.bundleEvents.push({ url: request.url(), slug, phase: "routed", t: Date.now(), delay });
        if (delay) await sleep(delay);
        state.served += 1;
        await route.fulfill({
          status: 200,
          headers: { ...cors, "content-type": "application/gzip" },
          body: fx.read(`bundles/bundle-${variant}.tar.gz`)
        });
        state.bundleEvents.push({ url: request.url(), slug, phase: "fulfilled", t: Date.now() });
        return undefined;
      }
      return await route.fulfill({ status: 404, headers: cors, body: "not found" });
    } catch (error) {
      // The page aborted the request while we were "downloading" (AbortController) -> route already gone.
      state.bundleEvents.push({ url: request.url(), phase: "route-error", t: Date.now(), error: String(error.message || error).slice(0, 160) });
      return undefined;
    }
  });

  const isBundle = (request) => /\/content\/.+\.tar\.gz$/.test(request.url());
  context.on("request", (request) => {
    if (isBundle(request)) state.bundleEvents.push({ url: request.url(), slug: request.url().split("/")[5], phase: "request", t: Date.now() });
  });
  context.on("requestfinished", (request) => {
    if (isBundle(request)) state.bundleEvents.push({ url: request.url(), slug: request.url().split("/")[5], phase: "finished", t: Date.now() });
  });
  context.on("requestfailed", (request) => {
    if (isBundle(request)) {
      state.bundleEvents.push({ url: request.url(), slug: request.url().split("/")[5], phase: "failed", t: Date.now(), failure: request.failure()?.errorText });
    }
  });

  return {
    state,
    setBundleDelay(ms) {
      state.bundleDelayMs = ms;
    },
    get bundleEvents() {
      return state.bundleEvents;
    }
  };
}

/** Same filter + sort semantics as staticBackend.searchNovels + DiscoverView (pt-BR localeCompare). */
export function expectedSearch(query, { siteId } = {}) {
  const fx = loadFixtures();
  const site = siteId ?? fx.manifest.primarySiteId;
  const q = query.trim().toLowerCase();
  const titles = fx.catalogs[site].novels
    .filter((novel) => !q || `${novel.title} ${novel.author || ""}`.toLowerCase().includes(q))
    .map((novel) => novel.title)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true, sensitivity: "base" }));
  return titles;
}
