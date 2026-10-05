#!/usr/bin/env node
/**
 * Publishes a new version of the desktop app. See docs/RELEASE.md.
 *
 *   node scripts/release.mjs 2.0.4 --notes "O que mudou"      # bump, commit, tag, push → CI does the rest
 *   node scripts/release.mjs 2.0.4 --notes-file notas.md
 *
 * The push of tag `v<versão>` starts .github/workflows/release.yml: it builds Mac and Windows,
 * signs the update packages, publishes the GitHub release (oghma.dev downloads from it) and the
 * updater's latest.json with both platforms. The tag message becomes the release notes.
 *
 * Emergency path (no CI; this computer's platform only, through the VPS):
 *   node scripts/release.mjs --local --notes "..."   [--skip-build]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_DIR = path.join(os.homedir(), ".config", "oghma");
const BASE_URL = "https://b2.jandson.me/atualizacoes";
const BUCKET_PREFIX = "atualizacoes";
const SSH_HOST = process.env.OGHMA_RELEASE_SSH ?? "vps";

const args = process.argv.slice(2);
const ROOT = path.resolve(APP, "..", "..");
const flag = (name) => args.includes(name);
const option = (name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const conf = JSON.parse(fs.readFileSync(path.join(APP, "src-tauri", "tauri.conf.json"), "utf8"));
const version = conf.version;
const notes = option("--notes") ?? (option("--notes-file") ? fs.readFileSync(option("--notes-file"), "utf8") : "");
const targetDir = process.env.CARGO_TARGET_DIR ?? path.join(APP, "src-tauri", "target");

function platformKey() {
  const arch = process.arch === "arm64" ? "aarch64" : process.arch === "x64" ? "x86_64" : process.arch;
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `windows-${arch}`;
  return `linux-${arch}`;
}

/** The signed updater package of this platform and its signature. */
function artifact() {
  const bundle = path.join(targetDir, "release", "bundle");
  if (process.platform === "darwin") {
    const file = path.join(bundle, "macos", `${conf.productName}.app.tar.gz`);
    return { file, remoteName: `Oghma-Library_${version}_${process.arch}.app.tar.gz` };
  }
  if (process.platform === "win32") {
    const dir = path.join(bundle, "nsis");
    const name = fs.readdirSync(dir).find((entry) => entry.endsWith("-setup.exe") && entry.includes(version));
    if (!name) throw new Error(`Instalador NSIS ${version} não encontrado em ${dir}`);
    return { file: path.join(dir, name), remoteName: `Oghma-Library_${version}_x64-setup.exe` };
  }
  throw new Error("Plataforma sem pacote de atualização configurado.");
}

/** Runs on the VPS: reads the bucket credentials from /opt/oghma/.env and uploads with boto3. */
const UPLOADER = `
import json, sys, boto3
env = {}
for line in open("/opt/oghma/.env"):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        key, value = line.split("=", 1)
        env[key] = value.strip().strip('"')
s3 = boto3.client("s3", endpoint_url=env["OGHMA_S3_ENDPOINT"], region_name=env["OGHMA_S3_REGION"],
                  aws_access_key_id=env["OGHMA_S3_ACCESS_KEY_ID"], aws_secret_access_key=env["OGHMA_S3_SECRET_ACCESS_KEY"])
for item in json.loads(sys.argv[1]):
    s3.upload_file(item["file"], env["OGHMA_S3_BUCKET"], item["key"],
                   ExtraArgs={"ContentType": item["type"], "CacheControl": item["cache"]})
    print("enviado", item["key"])
`;

function run(command, commandArgs, options = {}) {
  execFileSync(command, commandArgs, { stdio: "inherit", ...options });
}

function build() {
  const key = fs.readFileSync(path.join(KEY_DIR, "updater.key"), "utf8");
  const password = fs.readFileSync(path.join(KEY_DIR, "updater.key.password"), "utf8").trim();
  run("npx", ["tauri", "build"], {
    cwd: APP,
    shell: process.platform === "win32",
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password }
  });
}

async function currentManifest() {
  try {
    const response = await fetch(`${BASE_URL}/latest.json`, { cache: "no-store" });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Bumps the version everywhere, commits, tags and pushes; the release workflow builds and publishes. */
function ciRelease(next) {
  if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) throw new Error("Informe a versão nova: node scripts/release.mjs 2.0.4 --notes \"...\"");
  if (!notes.trim()) throw new Error("Escreva as novidades com --notes ou --notes-file (viram as notas da release e do botão Atualizar).");
  const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: ROOT, encoding: "utf8" }).trim();
  if (git("status", "--porcelain")) throw new Error("Há mudanças não commitadas. Faça o commit antes de lançar uma versão.");
  const current = version;
  const [a, b] = [next, current].map((v) => v.split(".").map(Number));
  const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  if (newer <= 0) throw new Error(`A versão nova (${next}) precisa ser maior que a atual (${current}).`);

  const edits = [
    ["src-tauri/tauri.conf.json", (text) => text.replace(`"version": "${current}"`, `"version": "${next}"`)],
    ["package.json", (text) => text.replace(`"version": "${current}"`, `"version": "${next}"`)],
    ["src-tauri/Cargo.toml", (text) => text.replace(`version = "${current}"`, `version = "${next}"`)],
    // The lock carries the package's own version too (the build would rewrite it otherwise).
    ["src-tauri/Cargo.lock", (text) => text.replace(/(name = "oghma-library"\nversion = ")[^"]+"/, `$1${next}"`)]
  ];
  for (const [file, edit] of edits) {
    const full = path.join(APP, file);
    const before = fs.readFileSync(full, "utf8");
    const after = edit(before);
    if (after === before) throw new Error(`Não achei a versão ${current} em ${file}.`);
    fs.writeFileSync(full, after);
  }
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  git("add", ...edits.map(([file]) => path.join("apps", "desktop", file)));
  git("commit", "-m", `Versão ${next}`);
  git("tag", "-a", `v${next}`, "-m", notes.trim());
  run("git", ["push", "origin", branch], { cwd: ROOT });
  run("git", ["push", "origin", `v${next}`], { cwd: ROOT });
  console.log(`Tag v${next} enviada. Acompanhe: https://github.com/Jand-S/Oghma-Library/actions`);
}

async function localRelease() {
  if (!flag("--skip-build")) build();
  const { file, remoteName } = artifact();
  const signature = fs.readFileSync(`${file}.sig`, "utf8").trim();
  const key = platformKey();
  const url = `${BASE_URL}/${version}/${remoteName}`;

  const previous = await currentManifest();
  const platforms = {};
  for (const [name, entry] of Object.entries(previous?.platforms ?? {})) {
    // Only keep other platforms already published at this version.
    if (name !== key && previous.version === version && entry.url.includes(`/${version}/`)) platforms[name] = entry;
  }
  platforms[key] = { signature, url };
  const manifest = {
    version,
    // Publishing the second platform of a version keeps the notes of the first.
    notes: notes || (previous?.version === version ? previous?.notes ?? "" : ""),
    pub_date: new Date().toISOString(),
    platforms
  };
  const manifestFile = path.join(os.tmpdir(), `oghma-latest-${Date.now()}.json`);
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  // Upload: package first, manifest last (an app never sees a manifest pointing at a missing file).
  const staging = `/tmp/oghma-release-${Date.now()}`;
  run("ssh", [SSH_HOST, `mkdir -p ${staging}`]);
  run("scp", ["-q", file, `${SSH_HOST}:${staging}/${remoteName}`]);
  run("scp", ["-q", manifestFile, `${SSH_HOST}:${staging}/latest.json`]);
  const uploads = JSON.stringify([
    { file: `${staging}/${remoteName}`, key: `${BUCKET_PREFIX}/${version}/${remoteName}`, type: "application/octet-stream", cache: "public, max-age=31536000, immutable" },
    { file: `${staging}/latest.json`, key: `${BUCKET_PREFIX}/latest.json`, type: "application/json", cache: "no-cache" }
  ]);
  execFileSync("ssh", [SSH_HOST, `sudo /opt/oghma/venv/bin/python - '${uploads}' && rm -rf ${staging}`], { input: UPLOADER, stdio: ["pipe", "inherit", "inherit"] });
  fs.rmSync(manifestFile, { force: true });

  const check = await currentManifest();
  if (check?.version !== version || !check.platforms?.[key]) throw new Error("latest.json publicado não confere.");
  console.log(`Publicado ${version} (${key}): ${url}`);
}

const main = async () => (flag("--local") ? localRelease() : ciRelease(args.find((arg) => /^\d/.test(arg))));

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
