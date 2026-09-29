// Motor de download/extração de bundles publicados no B2/CDN.
// Bundle = tar.gz com `meta.json` + `chapters/<n>.html` (ver backend/publish/bundles.py).
// Tudo em TS puro: gunzip nativo (DecompressionStream) + untar minimalista, sem dependencias.

export type BundleChapter = { number: number; title?: string; html: string };
export type BundleAsset = { name: string; data: Uint8Array; mediaType: string };

export type BundleMeta = {
  id?: string;
  source_id?: string;
  slug?: string;
  title?: string;
  bundle_version?: number;
  generated_at?: string;
  chapters?: Array<{ number: number; title?: string; file?: string; words?: number }>;
};

export type ExtractedBundle = { meta: BundleMeta | null; chapters: BundleChapter[]; assets: BundleAsset[] };

function assetMediaType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".avif")) return "image/avif";
  return "image/jpeg";
}

function parseOctal(bytes: Uint8Array): number {
  let s = "";
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i];
    if (b === 0 || b === 32) continue; // NUL / espaco
    s += String.fromCharCode(b);
  }
  return s ? parseInt(s, 8) : 0;
}

type TarEntry = { name: string; data: Uint8Array };

// Leitor de tar (ustar/GNU) suficiente para nossos bundles: nomes curtos ASCII,
// arquivos regulares, sem long-name/pax headers.
export function untar(buf: Uint8Array): TarEntry[] {
  const out: TarEntry[] = [];
  const dec = new TextDecoder();
  let off = 0;
  while (off + 512 <= buf.length) {
    const header = buf.subarray(off, off + 512);
    let nameEnd = 0;
    while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd += 1;
    const name = dec.decode(header.subarray(0, nameEnd));
    if (name === "") break; // bloco zero = fim do arquivo
    const size = parseOctal(header.subarray(124, 136));
    const typeflag = header[156];
    const dataStart = off + 512;
    if (typeflag === 0 || typeflag === 48 /* '0' */) {
      out.push({ name, data: buf.subarray(dataStart, dataStart + size).slice() });
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return out;
}

export async function gunzip(buf: ArrayBuffer): Promise<Uint8Array> {
  const body = new Response(buf).body;
  if (!body) throw new Error("Resposta sem corpo para descompactar");
  const stream = body.pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// --- Abort helpers (shared with downloadManager/downloadQueue) ---

export function createAbortError(message = "Download cancelado."): DOMException {
  return new DOMException(message, "AbortError");
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}

/** Like `signal.throwIfAborted()`, but always throws a DOMException AbortError. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw createAbortError();
}

// --- Bundle assembly ---

// Collects tar entries into an ExtractedBundle. Chapters are decoded right away,
// so their bytes are never retained; assets are copied so they don't pin a
// larger buffer (a network chunk or the whole tar) in memory.
class BundleAssembler {
  private readonly dec = new TextDecoder();
  private meta: BundleMeta | null = null;
  private readonly chapters: BundleChapter[] = [];
  private readonly assets: BundleAsset[] = [];

  add(name: string, data: Uint8Array): void {
    if (name === "meta.json") {
      try {
        this.meta = JSON.parse(this.dec.decode(data)) as BundleMeta;
      } catch {
        this.meta = null;
      }
      return;
    }
    const chapter = name.match(/^chapters\/([0-9.]+)\.html$/);
    if (chapter) {
      this.chapters.push({ number: Number(chapter[1]), html: this.dec.decode(data) });
      return;
    }
    const asset = name.match(/^assets\/([a-zA-Z0-9._-]+)$/);
    if (asset) this.assets.push({ name: asset[1], data: data.slice(), mediaType: assetMediaType(asset[1]) });
  }

  finish(): ExtractedBundle {
    const chapters = this.chapters.sort((a, b) => a.number - b.number);
    if (this.meta?.chapters) {
      const titles = new Map(this.meta.chapters.map((c) => [c.number, c.title]));
      for (const ch of chapters) ch.title = titles.get(ch.number);
    }
    return { meta: this.meta, chapters, assets: this.assets };
  }
}

// Incremental tar reader: accepts arbitrary chunks and emits regular-file entries
// as soon as they are complete, so the whole tar never has to sit in memory.
class TarStreamReader {
  private chunks: Uint8Array[] = [];
  private buffered = 0;
  private pendingEntry: { name: string; size: number; padded: number; regular: boolean } | null = null;
  private ended = false;
  private readonly dec = new TextDecoder();

  constructor(private readonly onEntry: (name: string, data: Uint8Array) => void) {}

  push(chunk: Uint8Array): void {
    if (this.ended || chunk.length === 0) return;
    this.chunks.push(chunk);
    this.buffered += chunk.length;
    this.drain();
  }

  private take(n: number): Uint8Array {
    const first = this.chunks[0];
    let out: Uint8Array;
    if (first.length >= n) {
      out = first.subarray(0, n);
      if (first.length === n) this.chunks.shift();
      else this.chunks[0] = first.subarray(n);
    } else {
      out = new Uint8Array(n);
      let offset = 0;
      while (offset < n) {
        const head = this.chunks[0];
        const count = Math.min(head.length, n - offset);
        out.set(head.subarray(0, count), offset);
        offset += count;
        if (count === head.length) this.chunks.shift();
        else this.chunks[0] = head.subarray(count);
      }
    }
    this.buffered -= n;
    return out;
  }

  private drain(): void {
    while (!this.ended) {
      if (!this.pendingEntry) {
        if (this.buffered < 512) return;
        const header = this.take(512);
        let nameEnd = 0;
        while (nameEnd < 100 && header[nameEnd] !== 0) nameEnd += 1;
        const name = this.dec.decode(header.subarray(0, nameEnd));
        if (name === "") {
          // Zero block = end of archive.
          this.ended = true;
          this.chunks = [];
          this.buffered = 0;
          return;
        }
        const size = parseOctal(header.subarray(124, 136));
        const typeflag = header[156];
        this.pendingEntry = {
          name,
          size,
          padded: Math.ceil(size / 512) * 512,
          regular: typeflag === 0 || typeflag === 48
        };
      }
      const entry = this.pendingEntry;
      if (this.buffered < entry.padded) return;
      const data = entry.padded > 0 ? this.take(entry.padded) : new Uint8Array(0);
      this.pendingEntry = null;
      if (entry.regular) this.onEntry(entry.name, data.subarray(0, entry.size));
    }
  }
}

export function extractBundle(tarBytes: Uint8Array): ExtractedBundle {
  const assembler = new BundleAssembler();
  new TarStreamReader((name, data) => assembler.add(name, data)).push(tarBytes);
  return assembler.finish();
}

function trimBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

export type BundleFetchProgress = { bytesReceived: number; bytesTotal?: number };

export type FetchBundleOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: BundleFetchProgress) => void;
};

function contentLength(res: Response): number | undefined {
  const raw = Number(res.headers.get("content-length"));
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

// Wraps the response body so every chunk is counted (progress) and the signal is
// checked between reads.
function countedBody(
  body: ReadableStream<Uint8Array>,
  total: number | undefined,
  options: FetchBundleOptions
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let received = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (options.signal?.aborted) {
        void reader.cancel().catch(() => undefined);
        controller.error(createAbortError());
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      received += value.byteLength;
      options.onProgress?.({ bytesReceived: received, bytesTotal: total === undefined ? undefined : Math.max(total, received) });
      controller.enqueue(value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    }
  });
}

async function extractFromGzipStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): Promise<ExtractedBundle> {
  const assembler = new BundleAssembler();
  const tar = new TarStreamReader((name, data) => assembler.add(name, data));
  const reader = (stream as ReadableStream<BufferSource>).pipeThrough(new DecompressionStream("gzip")).getReader();
  for (;;) {
    if (signal?.aborted) {
      void reader.cancel().catch(() => undefined);
      throw createAbortError();
    }
    const { done, value } = await reader.read();
    if (done) break;
    tar.push(value);
  }
  return assembler.finish();
}

function bundleUrl(serverUrl: string, bundleKey: string): string {
  return `${trimBase(serverUrl)}/${bundleKey.replace(/^\/+/, "")}`;
}

// Baixa e extrai o bundle de uma novel. `bundleKey` vem do catalogo
// (ex.: content/central-novel/<slug>/<slug>.v1.tar.gz).
// Forms: fetchBundle(serverUrl, bundleKey, opts?) or fetchBundle(fullUrl, opts?).
// The body is streamed: gzip and tar are decoded as bytes arrive, so neither the
// compressed file nor the whole tar is ever held in memory.
export async function fetchBundle(url: string, options?: FetchBundleOptions): Promise<ExtractedBundle>;
export async function fetchBundle(serverUrl: string, bundleKey: string, options?: FetchBundleOptions): Promise<ExtractedBundle>;
export async function fetchBundle(
  first: string,
  second?: string | FetchBundleOptions,
  third?: FetchBundleOptions
): Promise<ExtractedBundle> {
  const url = typeof second === "string" ? bundleUrl(first, second) : first;
  const options = (typeof second === "string" ? third : second) ?? {};
  const { signal } = options;
  throwIfAborted(signal);
  try {
    const res = await fetch(url, { cache: "no-store", signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
    const total = contentLength(res);
    const body = res.body;
    if (body && typeof body.getReader === "function" && typeof DecompressionStream !== "undefined") {
      return await extractFromGzipStream(countedBody(body, total, options), signal);
    }
    // Fallback: no streaming body available.
    const buffer = await res.arrayBuffer();
    throwIfAborted(signal);
    options.onProgress?.({ bytesReceived: buffer.byteLength, bytesTotal: Math.max(total ?? 0, buffer.byteLength) });
    return extractBundle(await gunzip(buffer));
  } catch (error) {
    if (signal?.aborted) throw createAbortError();
    throw error;
  }
}

function selectRange(chapters: BundleChapter[], range?: { start: number; end: number }): BundleChapter[] {
  if (!range) return chapters;
  return chapters.filter((c) => c.number >= range.start && c.number <= range.end);
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

// Gera um .txt simples do acervo (titulo + capitulos), respeitando a faixa.
export function bundleToText(
  title: string,
  chapters: BundleChapter[],
  range?: { start: number; end: number }
): string {
  const sel = selectRange(chapters, range);
  const parts = sel.map((c) => {
    const head = `Capitulo ${c.number}${c.title ? ` - ${c.title}` : ""}`;
    return `${head}\n\n${htmlToText(c.html)}`;
  });
  return `${title}\n\n\n${parts.join("\n\n\n")}\n`;
}

// Gera um HTML autocontido (util para visualizar ou converter depois em EPUB/PDF).
export function bundleToHtml(
  title: string,
  chapters: BundleChapter[],
  range?: { start: number; end: number }
): string {
  const sel = selectRange(chapters, range);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = sel
    .map((c) => {
      const head = `Capitulo ${c.number}${c.title ? ` - ${c.title}` : ""}`;
      const localHtml = c.html.replace(/\.\.\/assets\/([a-zA-Z0-9._-]+)/g, "assets/$1");
      return `<section class="chapter"><h2>${esc(head)}</h2>${localHtml}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>${esc(title)}</title>
<style>
  body { font-family: Georgia, serif; max-width: 42rem; margin: 0 auto; padding: 2rem 1.25rem; line-height: 1.6; }
  h1 { text-align: center; }
  .chapter { margin-top: 3rem; }
  .chapter h2 { border-bottom: 1px solid #ddd; padding-bottom: .3rem; }
  img { display: block; width: 100%; max-width: 100%; height: auto; object-fit: contain; margin: 1rem auto; }
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
</body>
</html>
`;
}
