// Static asset metrics for a built app (dist-bench/assets): raw/gzip/brotli bytes, CSS rule stats.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

function sizes(buf) {
  return {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 9 }).length,
    brotli: zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length }
    }).length
  };
}

function add(a, b) {
  return { raw: a.raw + b.raw, gzip: a.gzip + b.gzip, brotli: a.brotli + b.brotli };
}

/** Hex colour literals inside declaration blocks (innermost {...}), so #id selectors are not counted. */
export function cssTextStats(text) {
  const clean = text.replace(/\/\*[\s\S]*?\*\//g, "");
  let hex = 0;
  const unique = new Set();
  let declarations = 0;
  let varRefs = 0;
  let customProps = 0;
  let important = 0;
  for (const match of clean.matchAll(/\{([^{}]*)\}/g)) {
    const body = match[1];
    declarations += body.split(";").filter((d) => d.includes(":")).length;
    for (const h of body.matchAll(/#([0-9a-fA-F]{3,8})\b/g)) {
      if (![3, 4, 6, 8].includes(h[1].length)) continue;
      hex += 1;
      unique.add(h[1].toLowerCase());
    }
    varRefs += (body.match(/var\(--/g) || []).length;
    customProps += (body.match(/(^|;)\s*--[\w-]+\s*:/g) || []).length;
    important += (body.match(/!important/g) || []).length;
  }
  return { hexLiterals: hex, uniqueHex: unique.size, declarations, varRefs, customPropertyDefs: customProps, important };
}

/** Count CSS rules with the browser's own parser (CSSOM), recursing into grouping rules. */
export async function cssRuleStats(page, cssText) {
  return page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    const stats = { totalRules: 0, styleRules: 0, mediaRules: 0, supportsRules: 0, layerRules: 0, keyframesRules: 0, fontFaceRules: 0, containerRules: 0, selectors: 0 };
    const walk = (rules) => {
      for (const rule of rules) {
        stats.totalRules += 1;
        const type = rule.constructor.name;
        if (type === "CSSStyleRule") {
          stats.styleRules += 1;
          stats.selectors += rule.selectorText.split(",").length;
        } else if (type === "CSSMediaRule") stats.mediaRules += 1;
        else if (type === "CSSSupportsRule") stats.supportsRules += 1;
        else if (type.startsWith("CSSLayer")) stats.layerRules += 1;
        else if (type === "CSSKeyframesRule") stats.keyframesRules += 1;
        else if (type === "CSSFontFaceRule") stats.fontFaceRules += 1;
        else if (type === "CSSContainerRule") stats.containerRules += 1;
        if (rule.cssRules && type !== "CSSKeyframesRule") walk(rule.cssRules);
      }
    };
    walk(sheet.cssRules);
    return stats;
  }, cssText);
}

/**
 * @param {string} distDir  <app>/dist-bench
 * @param {import('playwright').Page} page  any page (used for CSSOM parsing)
 */
export async function analyzeDist(distDir, page) {
  const assetsDir = path.join(distDir, "assets");
  const files = fs.readdirSync(assetsDir).filter((f) => /\.(js|css)$/.test(f)).sort();
  const html = fs.readFileSync(path.join(distDir, "index.html"), "utf8");
  const entry = new Set([...html.matchAll(/(?:src|href)="\/?assets\/([^"]+)"/g)].map((m) => m[1]));
  const zero = { raw: 0, gzip: 0, brotli: 0 };
  const out = { distDir, files: [], js: { ...zero }, css: { ...zero }, entryJs: { ...zero }, entryCss: { ...zero } };
  let cssText = "";
  for (const file of files) {
    const buf = fs.readFileSync(path.join(assetsDir, file));
    const s = sizes(buf);
    const kind = file.endsWith(".css") ? "css" : "js";
    out.files.push({ file, kind, entry: entry.has(file), ...s });
    out[kind] = add(out[kind], s);
    if (entry.has(file)) out[kind === "css" ? "entryCss" : "entryJs"] = add(out[kind === "css" ? "entryCss" : "entryJs"], s);
    if (kind === "css") cssText += `${buf.toString("utf8")}\n`;
  }
  out.cssText = cssTextStats(cssText);
  out.cssRules = page ? await cssRuleStats(page, cssText) : null;
  return out;
}
