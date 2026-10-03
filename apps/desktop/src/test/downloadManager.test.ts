import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { ExtractedBundle } from "../services/bundle";
import {
  buildLocalBookManifest,
  buildOutputs,
  unavailableWarning,
  withUnavailableChapters,
  createSpeedMeter,
  isAbortError,
  runDownload,
  sanitizeFileName,
  type DownloadProgress
} from "../services/downloadManager";

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
  assets: [],
  chapters: [
    { number: 1, title: "Nightmare", html: "<p>Sunny acordou.</p>" },
    { number: 2, title: "Awaken", html: "<p>O pesadelo&nbsp;comecou.</p>" }
  ]
};

describe("downloadManager", () => {
  it("sanitizes file names", () => {
    expect(sanitizeFileName('A/B:C*?"')).toBe("A_B_C_");
  });

  it("buildOutputs makes TXT and EPUB per requested formats", async () => {
    const txt = await buildOutputs(sampleBundle, "Shadow Slave", ["TXT"]);
    expect(txt).toHaveLength(1);
    expect(txt[0].fileName).toBe("Shadow Slave.txt");
    expect(txt[0].data).toContain("Capítulo 1 - Nightmare");

    const both = await buildOutputs(sampleBundle, "Shadow Slave", ["TXT", "EPUB"]);
    expect(both.map((o) => o.fileName)).toEqual(["Shadow Slave.epub", "Shadow Slave.txt"]);
    expect(both[0].data).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode((both[0].data as Uint8Array).slice(0, 64))).toContain("PK");
  });

  it("embeds assets in EPUB and saves them beside offline HTML", async () => {
    const bundle: ExtractedBundle = {
      meta: { title: "Com imagens" },
      chapters: [{ number: 1, html: '<p><img src="../assets/abc.webp"></p>' }],
      assets: [{ name: "abc.webp", mediaType: "image/webp", data: new TextEncoder().encode("image-bytes") }]
    };
    const epub = await buildOutputs(bundle, "Com imagens", ["EPUB"]);
    expect(epub).toHaveLength(1);
    expect(new TextDecoder().decode(epub[0].data as Uint8Array)).toContain("OEBPS/assets/abc.webp");

    const html = await buildOutputs(bundle, "Com imagens", ["PDF"]);
    expect(html.map((item) => item.fileName)).toEqual(["Com imagens.html", "assets/abc.webp"]);
    expect(html[0].data).toContain('src="assets/abc.webp"');
    expect(html[0].data).toContain("width: 100%");
  });

  it("builds persistent metrics from the selected chapter range", async () => {
    const manifest = await buildLocalBookManifest(sampleBundle, { id: "central:ss", title: "Shadow Slave" }, { start: 2, end: 2 });
    expect(manifest.chapter_count).toBe(1);
    expect(manifest.chapters.map((chapter) => chapter.number)).toEqual([2]);
    expect(manifest.source_chars).toBeGreaterThan(0);
    expect(manifest.analysis_format).toBe("bundle");
  });

  it("serializes HTML void tags and entities as valid EPUB XHTML", async () => {
    const bundle: ExtractedBundle = {
      meta: null, assets: [],
      chapters: [{ number: 1, html: '<p>Texto&nbsp;&amp; nota<br>Fim</p><hr><p><img src="image.jpg" /></p>' }]
    };
    const outputs = await buildOutputs(bundle, "Teste", ["EPUB"]);
    const raw = new TextDecoder().decode(outputs[0].data as Uint8Array);
    const documents = raw.match(/<\?xml[^?]*\?>\s*<!DOCTYPE html>[^]*?<\/html>/g) ?? [];
    expect(documents.length).toBeGreaterThanOrEqual(2);
    for (const xml of documents) {
      const parsed = new DOMParser().parseFromString(xml, "application/xhtml+xml");
      expect(parsed.querySelector("parsererror")).toBeNull();
    }
  });

  it("empty and missing chapters become an 'indisponível na fonte' page instead of stopping the book", async () => {
    const bundle: ExtractedBundle = {
      ...sampleBundle,
      meta: { ...(sampleBundle.meta ?? {}), missingChapters: [{ number: 3, title: "O Terceiro", reason: "http_404" }] },
      chapters: [...sampleBundle.chapters, { number: 50, html: "<p> </p><hr>" }]
    };
    const { bundle: filled, unavailable } = withUnavailableChapters(bundle);
    expect(unavailable).toEqual([3, 50]);
    expect(filled.chapters.map((c) => c.number)).toEqual([...sampleBundle.chapters.map((c) => c.number), 3, 50].sort((a, b) => a - b));
    expect(filled.chapters.find((c) => c.number === 3)?.title).toBe("O Terceiro");
    expect(filled.chapters.find((c) => c.number === 50)?.html).toContain("indisponível na fonte");
    expect(unavailableWarning(unavailable)).toBe("2 capítulos indisponíveis na fonte (3, 50); o livro tem uma página no lugar de cada um.");

    const outputs = await buildOutputs(bundle, "Teste", ["TXT"]);
    expect(outputs[0].data).toContain("Capítulo indisponível na fonte.");
    // Fora da faixa escolhida nada muda.
    expect(withUnavailableChapters(bundle, { start: 1, end: 2 }).unavailable).toEqual([]);
    expect(unavailableWarning([])).toBeNull();
  });

  it("uses the novel id as the EPUB identifier, falling back to the title", async () => {
    const withId = await buildOutputs(sampleBundle, "Shadow Slave", ["EPUB"], undefined, undefined, undefined, undefined, "central-novel:ss");
    const withoutId = await buildOutputs(sampleBundle, "Shadow Slave", ["EPUB"]);
    const decode = (data: unknown) => new TextDecoder().decode(data as Uint8Array);

    expect(decode(withId[0].data)).toContain('<dc:identifier id="book-id">oghma:central-novel:ss</dc:identifier>');
    expect(decode(withoutId[0].data)).toContain('<dc:identifier id="book-id">oghma:Shadow Slave</dc:identifier>');
  });

  it("embeds the novel cover in EPUB metadata", async () => {
    const epub = await buildOutputs(
      sampleBundle,
      "Shadow Slave",
      ["EPUB"],
      undefined,
      undefined,
      { name: "cover.jpg", mediaType: "image/jpeg", data: new TextEncoder().encode("cover-bytes") }
    );
    const raw = new TextDecoder().decode(epub[0].data as Uint8Array);

    expect(raw).toContain('properties="cover-image"');
    expect(raw).toContain('<meta name="cover" content="cover-image"/>');
    expect(raw).toContain("OEBPS/cover.jpg");
    expect(raw).toContain("OEBPS/cover.xhtml");
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
    expect(JSON.parse(saved[".oghma-book.json"]).chapter_count).toBe(2);
    expect(progress[progress.length - 1]).toBe(100);
  });

  async function sampleGz() {
    return gzipBytes(buildTar([
      { name: "meta.json", body: JSON.stringify({ title: "Shadow Slave", chapters: [] }) },
      { name: "chapters/1.html", body: "<p>um</p>" },
      { name: "chapters/2.html", body: "<p>dois</p>" }
    ]));
  }

  const request = {
    serverUrl: "https://b2.example",
    novel: { id: "central-novel:ss", title: "Shadow Slave", bundleKey: "content/central-novel/ss/ss.v1.tar.gz", coverUrl: "https://cdn.example/ss.png" },
    formats: ["TXT", "EPUB"] as Array<"TXT" | "EPUB">,
    outputDir: "C:/out"
  };

  function stubNetwork(gz: ArrayBuffer, chunkSize = 64) {
    const bytes = new Uint8Array(gz);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith(".png")) return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "image/png" } });
      let offset = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (offset >= bytes.length) return controller.close();
          controller.enqueue(bytes.slice(offset, offset + chunkSize));
          offset += chunkSize;
        }
      });
      return new Response(body, { status: 200, headers: { "content-length": String(bytes.length) } });
    }));
  }

  it("runDownload reports stages, bytes, speed and ETA, and saves the cover", async () => {
    stubNetwork(await sampleGz(), 16);
    let clock = 0;
    const details: DownloadProgress[] = [];
    const saved: string[] = [];
    const files = await runDownload(request, {
      save: async (name) => { saved.push(name); },
      saveCover: true,
      now: () => (clock += 60),
      onProgress: (_percent, detail) => details.push(detail)
    });

    expect(files).toEqual(["Shadow Slave.epub", "Shadow Slave.txt"]);
    expect(saved).toEqual(["Shadow Slave.epub", "Shadow Slave.txt", "cover.png", ".oghma-book.json"]);
    const stages = Array.from(new Set(details.map((d) => d.stage)));
    expect(stages).toEqual(["fetching", "building", "saving", "done"]);
    const fetching = details.filter((d) => d.stage === "fetching" && d.bytesTotal);
    expect(fetching.length).toBeGreaterThan(0);
    expect(fetching.some((d) => (d.speedBps ?? 0) > 0 && d.etaSec !== undefined)).toBe(true);
    expect(fetching[fetching.length - 1].bytesReceived).toBe(fetching[fetching.length - 1].bytesTotal);
    expect(details.find((d) => d.stage === "saving")?.chaptersDone).toBe(2);
    const percents = details.map((d) => d.percent);
    expect(percents.every((p, i) => i === 0 || p >= percents[i - 1])).toBe(true);
    expect(percents[percents.length - 1]).toBe(100);
  });

  it("runDownload writes to opts.outputDir when given", async () => {
    stubNetwork(await sampleGz());
    const mod = await import("../services/localFiles");
    const spy = vi.spyOn(mod, "saveLocalFile").mockResolvedValue(undefined);
    await runDownload({ ...request, formats: ["TXT"] }, { outputDir: "/books/.oghma-staging/ss-1" });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.every(([dir]) => dir === "/books/.oghma-staging/ss-1")).toBe(true);
    spy.mockRestore();
  });

  it("runDownload rejects with AbortError before touching the network when already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();
    const save = vi.fn();
    const error = await runDownload(request, { signal: controller.signal, save }).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it("runDownload stops between file saves when aborted", async () => {
    stubNetwork(await sampleGz());
    const controller = new AbortController();
    const saved: string[] = [];
    const error = await runDownload(request, {
      signal: controller.signal,
      save: async (name) => {
        saved.push(name);
        controller.abort();
      }
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect(isAbortError(error)).toBe(true);
    expect(saved).toEqual(["Shadow Slave.epub"]);
  });

  it("runDownload aborts while building the EPUB", async () => {
    stubNetwork(await sampleGz());
    const controller = new AbortController();
    const save = vi.fn();
    const error = await runDownload(request, {
      signal: controller.signal,
      save,
      onProgress: (_p, detail) => { if (detail.stage === "building" && detail.percent > 60) controller.abort(); }
    }).catch((e: unknown) => e);
    expect(isAbortError(error)).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it("createSpeedMeter smooths samples with an EWMA", () => {
    let t = 0;
    const meter = createSpeedMeter(() => t, 0.5, 100);
    meter.sample(0);
    t = 1000;
    expect(meter.sample(1000)).toBe(1000);
    t = 2000;
    expect(meter.sample(4000)).toBe(2000); // 0.5 * 3000 + 0.5 * 1000
    t = 2050;
    expect(meter.sample(9000)).toBe(2000); // below the sample window
  });

  it("runDownload rejects a novel without a bundle", async () => {
    await expect(
      runDownload({ serverUrl: "https://b2.example", novel: { id: "x", title: "X" }, formats: ["TXT"], outputDir: "C:/out" })
    ).rejects.toThrow(/bundle/);
  });
});

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.unstubAllGlobals());
