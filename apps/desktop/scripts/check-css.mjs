#!/usr/bin/env node
/**
 * Zero-dependency CSS guard for the design system (`npm run lint:css`).
 *
 * Scans src/**\/*.css (except styles/tokens.css) and reports:
 *   - raw hex colors
 *   - rgb()/rgba()/hsl()/hsla() with literal channels (rgb(var(--x-rgb) / .5) is fine)
 *   - px literals other than 0 and ±1px (media/container query conditions are not checked)
 *   - !important
 *   - rules outside an @layer block
 *   - duplicate selectors inside the same layer and at-rule context
 *
 * Every finding is an error: the run exits 1 if there is any.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(appRoot, "src");

const EXCLUDED = new Set(["styles/tokens.css"]);

function listCssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listCssFiles(full));
    else if (name.endsWith(".css")) out.push(full);
  }
  return out;
}

/** Replaces comments with spaces so offsets and line numbers stay valid. */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, " "));
}

function lineCol(css, index) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < index; i += 1) {
    if (css[i] === "\n") {
      line += 1;
      last = i;
    }
  }
  return `${line}:${index - last}`;
}

/**
 * Minimal block parser: yields declarations (with their context stack) and
 * rules (with their selector and context). Good enough for hand-written CSS.
 */
function parse(css) {
  const events = [];
  const stack = [];
  let buffer = "";
  let start = -1;
  let quote = "";
  let parens = 0;

  const flush = (kind) => {
    const text = buffer.trim();
    const at = start;
    buffer = "";
    start = -1;
    if (!text) return;
    if (kind === "open") {
      if (text.startsWith("@")) {
        const match = /^@([\w-]+)\s*([\s\S]*)$/.exec(text);
        stack.push({ type: "at", name: match[1].toLowerCase(), params: match[2].trim(), index: at });
      } else {
        const node = { type: "rule", selector: text, index: at };
        events.push({ kind: "rule", node, context: [...stack] });
        stack.push(node);
      }
      return;
    }
    // Declaration or at-statement (e.g. `@import`, `@layer a, b;`).
    if (text.startsWith("@")) {
      events.push({ kind: "statement", text, index: at, context: [...stack] });
      return;
    }
    const colon = text.indexOf(":");
    if (colon === -1) return;
    events.push({
      kind: "decl",
      prop: text.slice(0, colon).trim(),
      value: text.slice(colon + 1).trim(),
      index: at,
      context: [...stack]
    });
  };

  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (quote) {
      buffer += ch;
      if (ch === "\\") {
        buffer += css[i + 1] ?? "";
        i += 1;
      } else if (ch === quote) {
        quote = "";
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      if (start === -1) start = i;
      buffer += ch;
      continue;
    }
    if (ch === "(") parens += 1;
    if (ch === ")") parens = Math.max(0, parens - 1);
    if (parens === 0 && ch === "{") {
      flush("open");
      continue;
    }
    if (parens === 0 && ch === ";") {
      flush("decl");
      continue;
    }
    if (parens === 0 && ch === "}") {
      flush("decl");
      stack.pop();
      continue;
    }
    if (start === -1 && !/\s/.test(ch)) start = i;
    buffer += ch;
  }
  return events;
}

function layerOf(context) {
  const layers = context.filter((node) => node.type === "at" && node.name === "layer").map((node) => node.params);
  return layers.length ? layers.join(".") : null;
}

function atContextKey(context) {
  return context
    .filter((node) => node.type === "at" && node.name !== "layer")
    .map((node) => `@${node.name} ${node.params.replace(/\s+/g, " ")}`)
    .join(" / ");
}

function inKeyframes(context) {
  return context.some((node) => node.type === "at" && /keyframes$/.test(node.name));
}

function normalizeSelector(selector) {
  return selector
    .split(",")
    .map((part) => part.trim().replace(/\s+/g, " ").replace(/\s*([>+~])\s*/g, " $1 "))
    .sort()
    .join(", ");
}

/** Removes url(...) bodies and quoted strings so data URIs and text never trip the checks. */
function scrubValue(value) {
  return value
    .replace(/url\((?:[^()]|\([^()]*\))*\)/gi, "url()")
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
}

function checkValue(value) {
  const problems = [];
  const clean = scrubValue(value);
  const hex = clean.match(/#[0-9a-fA-F]{3,8}\b/g);
  if (hex) problems.push(["raw-hex", `raw hex color ${hex.join(", ")}; use a color token`]);
  const colorFn = /\b(rgba?|hsla?)\(\s*([^)]*)/gi;
  for (let match = colorFn.exec(clean); match; match = colorFn.exec(clean)) {
    if (!match[2].trim().startsWith("var(")) {
      problems.push(["raw-color", `${match[1]}() with literal channels; use a token or rgb(var(--x-rgb) / a)`]);
    }
  }
  const px = clean.match(/(?<![\w.-])-?\d*\.?\d+px\b/g);
  const badPx = (px ?? []).filter((literal) => !/^-?(0|1)px$/.test(literal) && !/^-?0*\.?0+px$/.test(literal));
  if (badPx.length) problems.push(["raw-px", `px literal ${badPx.join(", ")}; use a spacing/size token`]);
  if (/!\s*important/i.test(clean)) problems.push(["important", "!important is not allowed; use cascade layers"]);
  return problems;
}

const files = listCssFiles(srcRoot)
  .map((full) => ({ full, rel: relative(srcRoot, full).split(sep).join("/") }))
  .filter(({ rel }) => !EXCLUDED.has(rel))
  .sort((a, b) => a.rel.localeCompare(b.rel));

const errors = [];
const seenSelectors = new Map();

for (const { full, rel } of files) {
  const css = stripComments(readFileSync(full, "utf8"));
  const report = (index, code, message) => {
    const entry = `src/${rel}:${lineCol(css, index)}  ${code}  ${message}`;
    errors.push(entry);
  };

  for (const event of parse(css)) {
    if (event.kind === "decl") {
      for (const [code, message] of checkValue(event.value)) {
        report(event.index, code, `${event.prop}: ${message}`);
      }
      continue;
    }
    if (event.kind !== "rule" || inKeyframes(event.context)) continue;
    const layer = layerOf(event.context);
    if (!layer) {
      report(event.node.index, "unlayered", `"${event.node.selector}" is outside an @layer block`);
      continue;
    }
    const key = `${layer}|${atContextKey(event.context)}|${normalizeSelector(event.node.selector)}`;
    const previous = seenSelectors.get(key);
    if (previous) {
      report(event.node.index, "duplicate", `"${event.node.selector}" already declared in layer ${layer} at ${previous}`);
    } else {
      seenSelectors.set(key, `src/${rel}:${lineCol(css, event.node.index)}`);
    }
  }
}

for (const entry of errors) console.error(entry);
console.log(`\nlint:css  ${errors.length} error(s) in ${files.length} file(s)`);
process.exit(errors.length > 0 ? 1 : 0);
