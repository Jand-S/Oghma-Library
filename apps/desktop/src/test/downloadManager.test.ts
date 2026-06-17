import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { ExtractedBundle } from "../services/bundle";
import { buildOutputs, runDownload, sanitizeFileName } from "../services/downloadManager";

function tarHeader(name: string, size: number): Uint8Array {
  const h = new Uint8Array(512);
  const enc = new TextEncoder();
  h.set(enc.encode(name), 0);
  h.set(enc.encode(size.toString(8).padStart(11, "0") + "\0"), 124);
  h[156] = 48;
  for (let i = 148; i < 156; i += 1) h[i] = 32;
  let sum = 0;
  for (let i = 0; i < 512; i += 1) sum += h[i];
  h.set(enc.encode(sum.toString(8).padStart(6, "0") + "\0 "), 148);
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
  blocks.push(new Uint8Array(1024));
  const total = blocks.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of blocks) { out.set(b, off); off += b.length; }
  return out;
}
async function gzipBytes(bytes: Uint8Array): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(bytes.slice());
  void writer.close();
  return new Response(cs.readable).arrayBuffer();
}

const sampleBundle: ExtractedBundle = {
  meta: { title: "Shadow Slave" },
  chapters: [
    { number: 1, title: "Nightmare", html: "<p>Sunny acordou.</p>" },
    { number: 2, title: "Awaken", html: "<p>O pesadelo&nbsp;comecou.</p>" }
  ]
};

describe("downloadManager", () => {
  it("sanitizes file names", () => {
    expect(sanitizeFileName('A/B:C*?"')).toBe("A_B_C_");
  });

  it("buildOutputs makes TXT and EPUB per requested formats", () => {
    const txt = buildOutputs(sampleBundle, "Shadow Slave", ["TXT"]);
    expect(txt).toHaveLength(1);
    expect(txt[0].fileName).toBe("Shadow Slave.txt");
    expect(txt[0].data).toContain("Capitulo 1 - Nightmare");

    const both = buildOutputs(sampleBundle, "Shadow Slave", ["TXT", "EPUB"]);
    expect(both.map((o) => o.fileName)).toEqual(["Shadow Slave.epub", "Shadow Slave.txt"]);
    expect(both[0].data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode((both[0].data as Uint8Array).slice(0, 64))).toContain("PK");
  });

  it("runDownload fetches, builds and saves with progress", async () => {
    const gz = await gzipBytes(buildTar([
      { name: "meta.json", body: JSON.stringify({ title: "Shadow Slave", chapters: [] }) },
      { name: "chapters/1.html", body: "<p>um</p>" },
      { name: "chapters/2.html", body: "<p>dois</p>" }
    ]));
    vi.stubGlobal("fetch", vi.fn(async () => new Response(gz, { status: 200 })));
    const saved: Record<string, string> = {};
    const progress: number[] = [];
    const files = await runDownload(
      {
        serverUrl: "https://b2.example",
        novel: { id: "central-novel:ss", title: "Shadow Slave", bundleKey: "content/central-novel/ss/ss.v1.tar.gz" },
        formats: ["TXT"],
        outputDir: "C:/out"
      },
      { save: async (n, d) => { saved[n] = typeof d === "string" ? d : new TextDecoder().decode(d); }, onProgress: (p) => progress.push(p) }
    );
    expect(files).toEqual(["Shadow Slave.txt"]);
    expect(saved["Shadow Slave.txt"]).toContain("um");
    expect(progress[progress.length - 1]).toBe(100);
  });

  it("runDownload rejects a novel without a bundle", async () => {
    await expect(
      runDownload({ serverUrl: "https://b2.example", novel: { id: "x", title: "X" }, formats: ["TXT"], outputDir: "C:/out" })
    ).rejects.toThrow(/bundle/);
  });
});

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());
