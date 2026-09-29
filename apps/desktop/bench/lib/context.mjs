// Browser/context factory: fake Tauri runtime + seeded config + probe + fixture routes.
import path from "node:path";
import { chromium } from "playwright";
import { BENCH_DIR, FIXTURE_SERVER_URL, loadFixtures, routeFixtures } from "./fixtures.mjs";

export const USER_AGENTS = {
  // Tauri on Windows = WebView2 (Edge/Chromium)
  windows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  // Tauri on macOS = WKWebView (Safari/WebKit-like UA)
  macos: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  // Tauri on Linux = WebKitGTK
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
};

export function seededAppConfig(overrides = {}) {
  const fx = loadFixtures();
  return {
    serverUrl: FIXTURE_SERVER_URL,
    outputPath: "~/Documents/Oghma Library/exports",
    enabledSourceIds: fx.index.sites.map((site) => site.id),
    indexMode: "incremental_recent",
    defaultFormats: ["EPUB"],
    translateDefault: false,
    audiobookDefault: false,
    targetLanguage: "PT-BR",
    translationEngine: "local",
    ttsVoice: "pt-BR-Antonio",
    ttsSpeed: 1,
    audioFormat: "M4B",
    syncOnLaunch: true,
    ...overrides
  };
}

export async function launchBrowser({ headed = false } = {}) {
  return chromium.launch({
    headless: !headed,
    args: [
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--enable-precise-memory-info"
    ]
  });
}

/**
 * @param {import('playwright').Browser} browser
 * @param {object} opts
 *  - version: entry from versions.mjs (provides probe watchers)
 *  - setup: 'complete' | 'fresh'
 *  - libraryCount: how many fixture books the shim returns from list_export_library
 *  - kindle: boolean (detect_kindle connected)
 *  - platform: 'windows' | 'macos' | 'linux'
 *  - viewport, deviceScaleFactor
 *  - bundleDelayMs
 */
export async function newBenchContext(browser, opts = {}) {
  const fx = loadFixtures();
  const platform = opts.platform || "windows";
  const context = await browser.newContext({
    viewport: opts.viewport || { width: 1280, height: 800 },
    deviceScaleFactor: opts.deviceScaleFactor || 1,
    userAgent: USER_AGENTS[platform],
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    colorScheme: opts.colorScheme || "dark",
    reducedMotion: opts.reducedMotion || "no-preference",
    acceptDownloads: false
  });
  const libraryCount = opts.libraryCount ?? fx.library.length;
  const config = {
    setup: opts.setup || "complete",
    platform,
    appConfig: seededAppConfig(opts.appConfig),
    tauri: opts.tauri !== false,
    shim: {
      library: fx.library.slice(0, libraryCount),
      coverDataUrls: fx.coverDataUrls,
      kindle: Boolean(opts.kindle),
      invokeLatencyMs: opts.invokeLatencyMs ?? 0,
      dialogPath: opts.dialogPath
    },
    probe: {
      watchers: opts.version?.probeWatchers?.() ?? [],
      toastSelector: opts.version?.toastSelector
    }
  };
  await context.addInitScript({ content: `window.__BENCH_CONFIG__ = ${JSON.stringify(config)};` });
  await context.addInitScript({ path: path.join(BENCH_DIR, "tauri-shim.js") });
  await context.addInitScript({ path: path.join(BENCH_DIR, "lib", "probe.js") });
  const routes = await routeFixtures(context, { bundleDelayMs: opts.bundleDelayMs ?? 0 });
  return { context, routes, config };
}

export async function cdpMetrics(page, { gc = true } = {}) {
  const cdp = await page.context().newCDPSession(page);
  try {
    if (gc) {
      await cdp.send("HeapProfiler.enable");
      await cdp.send("HeapProfiler.collectGarbage");
      await cdp.send("HeapProfiler.collectGarbage");
    }
    await cdp.send("Performance.enable");
    const { metrics } = await cdp.send("Performance.getMetrics");
    const out = {};
    for (const metric of metrics) out[metric.name] = metric.value;
    return out;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

export async function setCpuThrottle(page, rate) {
  if (!rate || rate === 1) return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
}

export async function disableCache(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
}
