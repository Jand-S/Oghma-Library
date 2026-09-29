#!/usr/bin/env node
// Builds dist-bench for both versions with identical flags: npx vite build --minify --outDir dist-bench
import { versions } from "../versions.mjs";
import { buildApp, parseArgs } from "./common.mjs";

const args = parseArgs();
for (const id of ["old", "new"]) {
  if (args.only && args.only !== id) continue;
  console.log(`[build] ${id}: ${versions[id].appDir}`);
  buildApp(versions[id].appDir);
}
