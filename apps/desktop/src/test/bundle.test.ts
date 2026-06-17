import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bundleToText, extractBundle, fetchBundle, htmlToText, untar } from "../services/bundle";

// --- mini tar writer (so para o teste) ---
function tarHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();
  h.set(enc.encode(name), 0);
  const octal = size.toString(8).padStart(11, "0") + "\0";
  h.set(enc.encode(octal), 124);
  h[156] = 48; // '0' = arquivo regular
  // checksum: espacos no campo, soma, octal
  for (let i = 148; i < 156; i += 1) h[i] = 32;
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += h[i];
  const chk = sum.toString(8).padStart(6, "0") + "\0 ";
  h.set(enc.encode(chk), 148);
  return h;
}

function buildTar(files: Array<{ name: string; body: string }>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: Uint8Array[] = [];
  for (const f of files) {
    const data = enc.encode(f.body);
    blocks.push(tarHeader(f.name, data.length));
    const padded = new Uint8Array(Math.ceil(data.length / 512) * 512);
    padded.set(data);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(1024)); // dois blocos zero
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) {
    out.set(b, off);
    off += b.length;
  }
  return out;
}

async function gzipBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(bytes.slice());
  void writer.close();
  return new Response(cs.readable).arrayBuffer();
}

const meta = {
  id: "central-novel:lord",
  slug: "lord",
  title: "Lord of Mysteries",
  bundle_version: 1,
  chapters: [
    { number: 1, title: "Crimson", file: "chapters/1.html", words: 10 },
    { number: 2, title: "Lunatic", file: "chapters/2.html", words: 12 }
  ]
};

const files = [
  { name: "meta.json", body: JSON.stringify(meta) },
  { name: "chapters/1.html", body: "<p>Klein abriu os olhos.</p><p>Tudo&nbsp;estranho.</p>" },
  { name: "chapters/2.html", body: "<div>A morte&amp;a vida.</div>" }
];

describe("bundle", () => {
  it("untar reads regular file entries", () => {
    const entries = untar(buildTar(files));
    expect(entries.map((e) => e.name)).toEqual(["meta.json", "chapters/1.html", "chapters/2.html"]);
  });

  it("extractBundle parses meta + chapters and joins titles", () => {
    const res = extractBundle(buildTar(files));
    expect(res.meta?.title).toBe("Lord of Mysteries");
    expect(res.chapters.map((c) => c.number)).toEqual([1, 2]);
    expect(res.chapters[0].title).toBe("Crimson");
    expect(res.chapters[0].html).toContain("Klein");
  });

  it("htmlToText strips tags and entities", () => {
    expect(htmlToText("<p>A&nbsp;B&amp;C</p>")).toBe("A B&C");
  });

  it("bundleToText respects the chapter range", () => {
    const res = extractBundle(buildTar(files));
    const txt = bundleToText("Lord of Mysteries", res.chapters, { start: 2, end: 2 });
    expect(txt).toContain("Capitulo 2 - Lunatic");
    expect(txt).not.toContain("Capitulo 1");
  });

  it("fetchBundle downloads, gunzips and extracts", async () => {
    const gz = await gzipBytes(buildTar(files));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(gz, { status: 200 }))
    );
    const res = await fetchBundle("https://b2.example", "content/central-novel/lord/lord.v1.tar.gz");
    expect(res.chapters).toHaveLength(2);
    expect(res.meta?.slug).toBe("lord");
  });
});

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());
