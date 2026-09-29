import { beforeAll, describe, expect, it } from "vitest";

// Vitest does not process CSS (`?raw` imports come back empty) and the app has no Node
// typings, so read the sheets through a runtime import of node:fs.
type Fs = { readFileSync(path: string, encoding: "utf8"): string; readdirSync(path: string): string[] };
const nodeFs = "node:fs";
let fs: Fs;
/** Absolute path of src/ (this file is src/test/ui/cssLayers.test.ts). */
const srcDir = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/test\/ui\/[^/]+$/, "");
const read = (rel: string) => fs.readFileSync(srcDir + rel, "utf8");
const cssIn = (dir: string) => fs.readdirSync(srcDir + dir).filter((name) => name.endsWith(".css")).map((name) => `${dir}/${name}`);
/** First non-comment statement of a stylesheet. */
const firstStatement = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").trim().split(";")[0];

beforeAll(async () => {
  fs = (await import(/* @vite-ignore */ nodeFs)) as Fs;
});

describe("cascade layer order", () => {
  it("is declared once, in layers.css, with components below features and utilities", () => {
    expect(firstStatement(read("styles/layers.css"))).toBe("@layer reset, tokens, base, layout, components, features, utilities");
    expect(firstStatement(read("styles/index.css"))).toBe('@import "./layers.css"');
  });

  // Production builds link the shared ui chunk's CSS before the entry CSS, so each of
  // these sheets may be the first to name a layer and must carry the order itself.
  it("starts every primitive and shell stylesheet with the layer order", () => {
    const sheets = [...cssIn("ui"), ...cssIn("shell")];
    expect(sheets.length).toBeGreaterThan(15);
    const missing = sheets.filter((file) => firstStatement(read(file)) !== '@import "../styles/layers.css"');
    expect(missing).toEqual([]);
  });
});
