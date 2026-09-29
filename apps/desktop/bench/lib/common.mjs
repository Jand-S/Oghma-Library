// Shared helpers: CLI args, stats, preview servers, output.
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { versions } from "../versions.mjs";

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      out._.push(token);
      continue;
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function quantile(values, q) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}
export const median = (values) => quantile(values, 0.5);
export const p95 = (values) => quantile(values, 0.95);

export function summarize(values) {
  const xs = values.filter((v) => typeof v === "number" && Number.isFinite(v));
  return {
    n: xs.length,
    missing: values.length - xs.length,
    median: median(xs),
    p95: p95(xs),
    min: xs.length ? Math.min(...xs) : null,
    max: xs.length ? Math.max(...xs) : null
  };
}

export function fmt(value, digits = 1) {
  if (value == null || Number.isNaN(value)) return "—";
  if (Math.abs(value) >= 1000) return Math.round(value).toLocaleString("en-US");
  return Number(value).toFixed(digits);
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function waitForUrl(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error(`Server did not come up: ${url}`);
}

/** Build <appDir>/dist-bench with minification (identical flags for both versions). */
export function buildApp(appDir) {
  execFileSync("npx", ["vite", "build", "--minify", "--outDir", "dist-bench", "--emptyOutDir"], { cwd: appDir, stdio: "inherit" });
}

/** Start `vite preview` for a version's dist-bench. Returns { url, stop }. */
export async function startPreview(version, { port = version.defaultPort } = {}) {
  if (!fs.existsSync(path.join(version.distDir, "index.html"))) {
    throw new Error(`Missing ${version.distDir}. Build first: (cd ${version.appDir} && npx vite build --minify --outDir dist-bench)`);
  }
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForUrl(url, 500);
    console.log(`[serve] reusing server already on ${url}`);
    return { url, stop: async () => undefined, reused: true };
  } catch {
    /* start one */
  }
  const child = spawn("npx", ["vite", "preview", "--outDir", "dist-bench", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], {
    cwd: version.appDir,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));
  try {
    await waitForUrl(url, 30000);
  } catch (error) {
    child.kill();
    throw new Error(`${error.message}\n${log}`);
  }
  console.log(`[serve] ${version.id}: ${url} (${version.appDir})`);
  return {
    url,
    stop: async () => {
      child.kill("SIGTERM");
      await sleep(100);
    }
  };
}

/**
 * Resolve { old: url, new: url } from --old/--new, starting preview servers when --serve is given
 * (or when a URL is omitted). --build rebuilds dist-bench first.
 */
export async function resolveTargets(args) {
  const targets = {};
  const stops = [];
  for (const id of ["old", "new"]) {
    const version = versions[id];
    if (args.only && args.only !== id) continue;
    if (typeof args[id] === "string" && !args.serve) {
      targets[id] = args[id].endsWith("/") ? args[id] : `${args[id]}/`;
      continue;
    }
    if (args.build) buildApp(version.appDir);
    const server = await startPreview(version, { port: typeof args[id] === "string" ? Number(new URL(args[id]).port) : version.defaultPort });
    targets[id] = server.url;
    stops.push(server.stop);
  }
  return { targets, stop: async () => Promise.all(stops.map((stop) => stop())) };
}

export function mdTable(headers, rows) {
  const line = (cells) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}
