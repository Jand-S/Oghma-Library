// Orquestra o download real: bundle do B2 -> saidas (TXT/HTML) -> grava em disco.
// Sem acoplar a UI: recebe dados + callbacks de progresso.
import type { DownloadFormat, JobProgress } from "../core/types";
import {
  bundleToHtml,
  bundleToText,
  createAbortError,
  fetchBundle,
  isAbortError,
  throwIfAborted,
  type ExtractedBundle
} from "./bundle";

export { createAbortError, isAbortError };
import { convertLocalEpubToAzw3, saveLocalFile, type FileData } from "./localFiles";

export type SaveFile = (fileName: string, data: FileData) => Promise<void>;

export type DownloadNovelInput = {
  id: string;
  title: string;
  bundleKey?: string;
  coverUrl?: string;
};

export type DownloadRequest = {
  serverUrl: string;
  novel: DownloadNovelInput;
  formats: DownloadFormat[];
  outputDir: string;
  range?: { start: number; end: number };
};

export function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim() || "novel";
}

type EpubCover = {
  name: string;
  mediaType: string;
  data: Uint8Array;
};

/** Progress detail reported by runDownload (second argument of onProgress). */
export type DownloadProgress = JobProgress;

export type RunDownloadOptions = {
  /** Custom writer; defaults to saveLocalFile into `outputDir`. */
  save?: SaveFile;
  /** `percent` keeps the old contract; `detail` carries stage, bytes, speed and ETA. */
  onProgress?: (percent: number, detail: DownloadProgress) => void;
  /** Cancels network and disk work; runDownload then rejects with a DOMException AbortError. */
  signal?: AbortSignal;
  /** Overrides `req.outputDir` (e.g. an export staging dir). */
  outputDir?: string;
  /** Also writes the cover as `cover.<ext>` (before any AZW3 conversion, which embeds it). */
  saveCover?: boolean;
  /** Clock for speed/ETA (ms). Defaults to performance.now/Date.now. */
  now?: () => number;
};

export const LOCAL_BOOK_MANIFEST = ".oghma-book.json";

export type LocalBookManifest = {
  schema_version: 1;
  novel_id: string;
  title: string;
  chapter_count: number;
  source_chars: number;
  word_count: number;
  analysis_format: "bundle";
  range_start: number | null;
  range_end: number | null;
  generated_at: string;
  chapters: Array<{ number: number; source_chars: number; word_count: number }>;
};

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff];
}

function u32(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

async function yieldToUi(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

const EMPTY_BYTES = new Uint8Array(0);

// Stored (uncompressed) zip. Takes ownership of `files`: each entry's data is
// released as soon as it has been copied into the output buffer.
async function createZip(
  files: Array<{ name: string; data: Uint8Array }>,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const prepared: Array<{
    name: Uint8Array;
    data: Uint8Array;
    size: number;
    crc: number;
    offset: number;
  }> = [];
  let offset = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    prepared.push({ name, data: file.data, size: file.data.length, crc, offset });
    files[index] = { name: file.name, data: EMPTY_BYTES };
    offset += 30 + name.length + file.data.length;
    onProgress?.(Math.round((45 * (index + 1)) / Math.max(files.length, 1)));
    if (index % 8 === 7 || file.data.length >= 1024 * 1024) await yieldToUi(signal);
  }

  const centralSize = prepared.reduce((sum, file) => sum + 46 + file.name.length, 0);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const file = prepared[index];
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(file.crc), ...u32(file.size), ...u32(file.size),
      ...u16(file.name.length), ...u16(0), ...file.name
    ]);
    out.set(localHeader, cursor);
    cursor += localHeader.length;
    out.set(file.data, cursor);
    cursor += file.size;
    file.data = EMPTY_BYTES;
    onProgress?.(45 + Math.round((45 * (index + 1)) / Math.max(prepared.length, 1)));
    if (index % 8 === 7 || file.size >= 1024 * 1024) await yieldToUi(signal);
  }

  const centralOffset = cursor;
  for (const file of prepared) {
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(file.crc), ...u32(file.size), ...u32(file.size),
      ...u16(file.name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(0), ...u32(file.offset), ...file.name
    ]);
    out.set(central, cursor);
    cursor += central.length;
  }

  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(cursor - centralOffset), ...u32(centralOffset), ...u16(0)
  ]);
  out.set(end, cursor);
  onProgress?.(100);
  return out;
}

function xhtmlDoc(title: string, body: string, stylesheetHref = "style.css"): string {
  const parsed = new DOMParser().parseFromString(body, "text/html");
  const serializer = new XMLSerializer();
  const xhtml = Array.from(parsed.body.childNodes, (node) => serializer.serializeToString(node)).join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="${xmlEscape(stylesheetHref)}"/></head>
<body>${xhtml}</body>
</html>`;
}

function referencedAssetNames(chapters: ExtractedBundle["chapters"]): Set<string> {
  const names = new Set<string>();
  for (const chapter of chapters) {
    for (const match of chapter.html.matchAll(/\.\.\/assets\/([a-zA-Z0-9._-]+)/g)) names.add(match[1]);
  }
  return names;
}

export async function buildLocalBookManifest(
  bundle: ExtractedBundle,
  novel: DownloadNovelInput,
  range?: { start: number; end: number },
  signal?: AbortSignal
): Promise<LocalBookManifest> {
  const selected = bundle.chapters.filter(
    (chapter) => !range || (chapter.number >= range.start && chapter.number <= range.end)
  );
  const chapters: LocalBookManifest["chapters"] = [];
  for (let index = 0; index < selected.length; index += 1) {
    const chapter = selected[index];
    const text = stripHtml(chapter.html);
    chapters.push({
      number: chapter.number,
      source_chars: Array.from(text).length,
      word_count: text ? text.split(/\s+/).length : 0
    });
    if (index % 25 === 24) await yieldToUi(signal);
  }
  return {
    schema_version: 1,
    novel_id: novel.id,
    title: novel.title,
    chapter_count: chapters.length,
    source_chars: chapters.reduce((sum, chapter) => sum + chapter.source_chars, 0),
    word_count: chapters.reduce((sum, chapter) => sum + chapter.word_count, 0),
    analysis_format: "bundle",
    range_start: range?.start ?? null,
    range_end: range?.end ?? null,
    generated_at: new Date().toISOString(),
    chapters
  };
}

function coverMediaType(contentType: string, url: string): { mediaType: string; ext: string } | null {
  const type = contentType.split(";")[0].trim().toLowerCase();
  if (type === "image/jpeg" || type === "image/jpg") return { mediaType: "image/jpeg", ext: "jpg" };
  if (type === "image/png") return { mediaType: "image/png", ext: "png" };
  if (type === "image/webp") return { mediaType: "image/webp", ext: "webp" };
  const path = url.split("?")[0].toLowerCase();
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return { mediaType: "image/jpeg", ext: "jpg" };
  if (path.endsWith(".png")) return { mediaType: "image/png", ext: "png" };
  if (path.endsWith(".webp")) return { mediaType: "image/webp", ext: "webp" };
  return null;
}

type FetchedCover = {
  data: Uint8Array;
  /** File extension for `cover.<ext>` (jpg when the type is unknown). */
  ext: string;
  /** Only set when the image type is known, i.e. when it can be embedded in the EPUB. */
  epub?: EpubCover;
};

async function fetchCover(coverUrl: string | undefined, signal?: AbortSignal): Promise<FetchedCover | undefined> {
  if (!coverUrl) return undefined;
  try {
    const response = await fetch(coverUrl, { cache: "no-store", signal });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    const media = coverMediaType(contentType, coverUrl);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) return undefined;
    if (!media) return { data, ext: "jpg" };
    return { data, ext: media.ext, epub: { name: `cover.${media.ext}`, mediaType: media.mediaType, data } };
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw createAbortError();
    return undefined;
  }
}

async function buildEpub(
  bundle: ExtractedBundle,
  title: string,
  range?: { start: number; end: number },
  onProgress?: (percent: number) => void,
  cover?: EpubCover,
  signal?: AbortSignal,
  novelId?: string
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const chapters = bundle.chapters.filter((chapter) => !range || (chapter.number >= range.start && chapter.number <= range.end));
  const assetNames = referencedAssetNames(chapters);
  const assets = bundle.assets.filter((asset) => assetNames.has(asset.name));
  const chapterFiles = chapters.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapters/chapter-${index + 1}.xhtml`,
    title: chapter.title || `Capitulo ${chapter.number}`,
    html: xhtmlDoc(
      chapter.title || `Capitulo ${chapter.number}`,
      `<h1>${xmlEscape(chapter.title || `Capitulo ${chapter.number}`)}</h1>${chapter.html}`,
      "../style.css"
    )
  }));
  const manifestItems = chapterFiles.map((file) => `<item id="${file.id}" href="${file.href}" media-type="application/xhtml+xml"/>`).join("\n    ");
  const spineItems = chapterFiles.map((file) => `<itemref idref="${file.id}"/>`).join("\n    ");
  const navItems = chapterFiles.map((file) => `<li><a href="${file.href}">${xmlEscape(file.title)}</a></li>`).join("\n      ");
  const assetManifest = assets.map((asset, index) => `<item id="asset-${index + 1}" href="assets/${asset.name}" media-type="${asset.mediaType}"/>`).join("\n    ");
  const coverManifest = cover
    ? `<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>\n    <item id="cover-image" href="${xmlEscape(cover.name)}" media-type="${cover.mediaType}" properties="cover-image"/>`
    : "";
  const coverSpine = cover ? '<itemref idref="cover-page" linear="no"/>' : "";
  const plainDescription = stripHtml(chapters[0]?.html ?? title);

  return createZip([
    { name: "mimetype", data: enc.encode("application/epub+zip") },
    { name: "META-INF/container.xml", data: enc.encode(`<?xml version="1.0" encoding="utf-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`) },
    { name: "OEBPS/content.opf", data: enc.encode(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">oghma:${xmlEscape(novelId || title)}</dc:identifier>
    <dc:title>${xmlEscape(title)}</dc:title>
    <dc:language>pt-BR</dc:language>
    <dc:description>${xmlEscape(plainDescription)}</dc:description>
    ${cover ? '<meta name="cover" content="cover-image"/>' : ""}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${coverManifest}
    ${manifestItems}
    ${assetManifest}
  </manifest>
  <spine>
    ${coverSpine}
    ${spineItems}
  </spine>
</package>`) },
    { name: "OEBPS/nav.xhtml", data: enc.encode(xhtmlDoc("Sumario", `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Sumario</h1><ol>${navItems}</ol></nav>`)) },
    ...(cover ? [
      { name: "OEBPS/cover.xhtml", data: enc.encode(xhtmlDoc("Capa", `<section class="cover-page"><img src="${xmlEscape(cover.name)}" alt="${xmlEscape(title)}" /></section>`)) },
      { name: `OEBPS/${cover.name}`, data: cover.data }
    ] : []),
    { name: "OEBPS/style.css", data: enc.encode("body{font-family:serif;line-height:1.55;margin:5%;} h1{font-size:1.35em;} img{display:block;width:100%;max-width:100%;height:auto;object-fit:contain;margin:1em auto;} .cover-page{margin:0;text-align:center;} .cover-page img{width:100%;max-height:95vh;object-fit:contain;}") },
    ...chapterFiles.map((file) => ({ name: `OEBPS/${file.href}`, data: enc.encode(file.html) })),
    ...assets.map((asset) => ({ name: `OEBPS/assets/${asset.name}`, data: asset.data }))
  ], onProgress, signal);
}

export async function buildOutputs(
  bundle: ExtractedBundle,
  title: string,
  formats: DownloadFormat[],
  range?: { start: number; end: number },
  onProgress?: (percent: number) => void,
  cover?: EpubCover,
  signal?: AbortSignal,
  /** Stable book id for the EPUB `dc:identifier` (falls back to the title). */
  novelId?: string
): Promise<Array<{ fileName: string; data: FileData }>> {
  throwIfAborted(signal);
  const empty = bundle.chapters.filter((chapter) => {
    if (range && (chapter.number < range.start || chapter.number > range.end)) return false;
    const doc = new DOMParser().parseFromString(chapter.html, "text/html");
    doc.querySelectorAll("script, style").forEach((node) => node.remove());
    return !doc.body.textContent?.trim() && !doc.body.querySelector("img[src]");
  });
  if (empty.length) {
    const numbers = empty.slice(0, 12).map((chapter) => chapter.number).join(", ");
    throw new Error(`O acervo publicado possui ${empty.length} capitulo(s) sem conteudo: ${numbers}${empty.length > 12 ? ", ..." : ""}. O download foi interrompido para evitar um livro incompleto.`);
  }
  const base = sanitizeFileName(title);
  const outputs: Array<{ fileName: string; data: FileData }> = [];
  if (formats.includes("EPUB")) {
    outputs.push({ fileName: `${base}.epub`, data: await buildEpub(bundle, title, range, onProgress, cover, signal, novelId) });
    throwIfAborted(signal);
  }
  if (formats.includes("TXT")) {
    outputs.push({ fileName: `${base}.txt`, data: bundleToText(title, bundle.chapters, range) });
  }
  // PDF ainda nao tem renderizador real: mantemos HTML como base exportavel por enquanto.
  if (formats.includes("PDF")) {
    outputs.push({ fileName: `${base}.html`, data: bundleToHtml(title, bundle.chapters, range) });
    const chapters = bundle.chapters.filter((chapter) => !range || (chapter.number >= range.start && chapter.number <= range.end));
    const names = referencedAssetNames(chapters);
    outputs.push(...bundle.assets.filter((asset) => names.has(asset.name)).map((asset) => ({
      fileName: `assets/${asset.name}`,
      data: asset.data
    })));
  }
  if (outputs.length === 0) {
    outputs.push({ fileName: `${base}.txt`, data: bundleToText(title, bundle.chapters, range) });
  }
  return outputs;
}

// Salvador padrao: usa o fs do Tauri (grava em outputDir) ou cai pro download do navegador.
export async function defaultSaveFile(outputDir: string): Promise<SaveFile> {
  return async (fileName, data) => saveLocalFile(outputDir, fileName, data);
}

// Smoothed transfer speed: EWMA over ~250ms samples.
export function createSpeedMeter(now: () => number, alpha = 0.3, sampleMs = 250) {
  let lastTime: number | null = null;
  let lastBytes = 0;
  let speed: number | undefined;
  return {
    /** Feeds the cumulative byte count; returns the current smoothed speed (bytes/s). */
    sample(bytes: number, force = false): number | undefined {
      const t = now();
      if (lastTime === null) {
        lastTime = t;
        lastBytes = bytes;
        return speed;
      }
      const dt = t - lastTime;
      if (dt <= 0 || (!force && dt < sampleMs)) return speed;
      const instant = ((bytes - lastBytes) * 1000) / dt;
      speed = speed === undefined ? instant : alpha * instant + (1 - alpha) * speed;
      lastTime = t;
      lastBytes = bytes;
      return speed;
    },
    get speed() {
      return speed;
    }
  };
}

function defaultNow(): number {
  return (globalThis.performance ?? Date).now();
}

// Percent budget of a download: fetch 5-60, build 60-80, save 80-94/100, AZW3 96-100.
export async function runDownload(req: DownloadRequest, opts: RunDownloadOptions = {}): Promise<string[]> {
  const { signal } = opts;
  const now = opts.now ?? defaultNow;
  const outputDir = opts.outputDir ?? req.outputDir;
  let last: DownloadProgress = { stage: "fetching", percent: 0 };
  const report = (patch: Partial<DownloadProgress> & { percent: number }) => {
    last = { ...last, ...patch, percent: Math.max(0, Math.min(100, Math.round(patch.percent))) };
    opts.onProgress?.(last.percent, last);
  };

  report({ stage: "fetching", percent: 5 });
  if (!req.novel.bundleKey) throw new Error(`"${req.novel.title}" ainda nao tem bundle publicado`);
  throwIfAborted(signal);

  // 1. Network: stream + extract the bundle.
  const meter = createSpeedMeter(now);
  let lastReport = -Infinity;
  let bundle: ExtractedBundle | null = await fetchBundle(req.serverUrl, req.novel.bundleKey, {
    signal,
    onProgress: ({ bytesReceived, bytesTotal }) => {
      const complete = bytesTotal !== undefined && bytesReceived >= bytesTotal;
      const speedBps = meter.sample(bytesReceived, complete);
      const t = now();
      if (!complete && t - lastReport < 100) return;
      lastReport = t;
      const etaSec = speedBps && bytesTotal !== undefined
        ? Math.max(0, Math.round((bytesTotal - bytesReceived) / speedBps))
        : undefined;
      const fraction = bytesTotal ? bytesReceived / bytesTotal : 0;
      report({ stage: "fetching", percent: 5 + fraction * 55, bytesReceived, bytesTotal, speedBps, etaSec });
    }
  });
  throwIfAborted(signal);
  const cover = await fetchCover(req.novel.coverUrl, signal);
  throwIfAborted(signal);

  // 2. Build outputs.
  const chaptersTotal = bundle.chapters.filter(
    (chapter) => !req.range || (chapter.number >= req.range.start && chapter.number <= req.range.end)
  ).length;
  report({ stage: "building", percent: 60, speedBps: undefined, etaSec: undefined, chaptersDone: 0, chaptersTotal });
  const needsAzw3 = req.formats.includes("AZW3");
  const buildFormats = req.formats.filter((format) => format !== "AZW3");
  if (needsAzw3 && !buildFormats.includes("EPUB")) buildFormats.push("EPUB");
  const manifest = await buildLocalBookManifest(bundle, req.novel, req.range, signal);
  let outputs: Array<{ fileName: string; data: FileData } | null> = await buildOutputs(
    bundle,
    req.novel.title,
    buildFormats,
    req.range,
    (percent) => report({
      stage: "building",
      percent: 60 + percent * 0.2,
      chaptersDone: Math.min(chaptersTotal, Math.round((percent / 100) * chaptersTotal))
    }),
    cover?.epub,
    signal,
    req.novel.id
  );
  bundle = null; // Outputs are built; let the extracted bundle go before writing.
  throwIfAborted(signal);

  // 3. Save.
  report({ stage: "saving", percent: 80, chaptersDone: chaptersTotal });
  const save = opts.save ?? (await defaultSaveFile(outputDir));
  const savedFiles: string[] = [];
  const saveProgressRange = needsAzw3 ? 14 : 20;
  for (let i = 0; i < outputs.length; i += 1) {
    throwIfAborted(signal);
    const output = outputs[i];
    if (!output) continue;
    await save(output.fileName, output.data);
    outputs[i] = null;
    savedFiles.push(output.fileName);
    await yieldToUi(signal);
    report({ stage: "saving", percent: 80 + (saveProgressRange * (i + 1)) / outputs.length });
  }
  outputs = [];
  if (opts.saveCover && cover) {
    throwIfAborted(signal);
    await save(`cover.${cover.ext}`, cover.data);
  }
  throwIfAborted(signal);
  await save(LOCAL_BOOK_MANIFEST, JSON.stringify(manifest, null, 2));

  // 4. Optional AZW3 (native only). The conversion itself cannot be interrupted.
  if (needsAzw3) {
    throwIfAborted(signal);
    report({ stage: "converting", percent: 96 });
    const azw3 = await convertLocalEpubToAzw3(req.novel.title, outputDir, savedFiles);
    if (!azw3) {
      throw new Error("Conversao AZW3 esta disponivel no app desktop.");
    }
    savedFiles.push(azw3);
  }
  report({ stage: "done", percent: 100 });
  return Array.from(new Set(savedFiles));
}
