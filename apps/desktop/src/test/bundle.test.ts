import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import {
  bundleToText,
  extractBundle,
  fetchBundle,
  htmlToText,
  isAbortError,
  untar
} from "../services/bundle";

// Response whose body is a ReadableStream that emits `bytes` in small chunks.
function chunkedResponse(bytes: Uint8Array, chunkSize: number, opts: { contentLength?: boolean; onPull?: (index: number) => void } = {}) {
  let offset = 0;
  let index = 0;
  const cancel = vi.fn();
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      opts.onPull?.(index);
      index += 1;
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
    cancel
  });
  const headers: Record<string, string> = opts.contentLength === false ? {} : { "content-length": String(bytes.length) };
  return { response: new Response(stream, { status: 200, headers }), cancel };
}

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
  { name: "chapters/1.html", body: '<p>Klein abriu os olhos.</p><img src="../assets/abc.webp">' },
  { name: "chapters/2.html", body: "<div>A morte&amp;a vida.</div>" },
  { name: "assets/abc.webp", body: "RIFFxxxxWEBPimage" }
];

describe("bundle", () => {
  it("untar reads regular file entries", () => {
    const entries = untar(buildTar(files));
    expect(entries.map((e) => e.name)).toEqual(["meta.json", "chapters/1.html", "chapters/2.html", "assets/abc.webp"]);
  });

  it("extractBundle parses meta + chapters and joins titles", () => {
    const res = extractBundle(buildTar(files));
    expect(res.meta?.title).toBe("Lord of Mysteries");
    expect(res.chapters.map((c) => c.number)).toEqual([1, 2]);
    expect(res.chapters[0].title).toBe("Crimson");
    expect(res.chapters[0].html).toContain("Klein");
    expect(res.assets).toHaveLength(1);
    expect(res.assets[0].mediaType).toBe("image/webp");
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

  it("fetchBundle streams the body in small chunks and reports byte progress", async () => {
    const gz = new Uint8Array(await gzipBytes(buildTar(files)));
    const { response } = chunkedResponse(gz, 7);
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<{ bytesReceived: number; bytesTotal?: number }> = [];
    const res = await fetchBundle("https://b2.example/", "/content/lord.tar.gz", { onProgress: (p) => progress.push(p) });

    expect(fetchMock).toHaveBeenCalledWith("https://b2.example/content/lord.tar.gz", expect.objectContaining({ cache: "no-store" }));
    expect(res.chapters.map((c) => [c.number, c.title])).toEqual([[1, "Crimson"], [2, "Lunatic"]]);
    expect(res.chapters[0].html).toContain("Klein");
    expect(new TextDecoder().decode(res.assets[0].data)).toBe("RIFFxxxxWEBPimage");
    expect(progress.length).toBeGreaterThan(2);
    expect(progress.every((p, i) => i === 0 || p.bytesReceived > progress[i - 1].bytesReceived)).toBe(true);
    expect(progress[progress.length - 1]).toEqual({ bytesReceived: gz.length, bytesTotal: gz.length });
  });

  it("fetchBundle accepts a full URL and works without content-length", async () => {
    const gz = new Uint8Array(await gzipBytes(buildTar(files)));
    const { response } = chunkedResponse(gz, 4096, { contentLength: false });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<{ bytesReceived: number; bytesTotal?: number }> = [];
    const res = await fetchBundle("https://b2.example/lord.tar.gz", { onProgress: (p) => progress.push(p) });
    expect(fetchMock).toHaveBeenCalledWith("https://b2.example/lord.tar.gz", expect.anything());
    expect(res.chapters).toHaveLength(2);
    expect(progress[progress.length - 1].bytesTotal).toBeUndefined();
  });

  it("fetchBundle stops reading and rejects with AbortError when aborted mid-stream", async () => {
    const gz = new Uint8Array(await gzipBytes(buildTar(files)));
    const controller = new AbortController();
    const { response } = chunkedResponse(gz, 5, { onPull: (index) => { if (index === 3) controller.abort(); } });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    const error = await fetchBundle("https://b2.example", "lord.tar.gz", { signal: controller.signal }).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(error).toBeInstanceOf(DOMException);
  });

  it("fetchBundle rejects immediately when the signal is already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchBundle("https://b2.example", "x.tar.gz", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fetchBundle falls back to arrayBuffer when the body is not a stream", async () => {
    const gz = await gzipBytes(buildTar(files));
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      body: null,
      headers: new Headers(),
      arrayBuffer: async () => gz
    })));
    const progress: Array<{ bytesReceived: number; bytesTotal?: number }> = [];
    const res = await fetchBundle("https://b2.example", "lord.tar.gz", { onProgress: (p) => progress.push(p) });
    expect(res.chapters).toHaveLength(2);
    expect(progress).toEqual([{ bytesReceived: gz.byteLength, bytesTotal: gz.byteLength }]);
  });

  it("fetchBundle surfaces HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(fetchBundle("https://b2.example", "x.tar.gz")).rejects.toThrow(/HTTP 404/);
  });
});

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());
