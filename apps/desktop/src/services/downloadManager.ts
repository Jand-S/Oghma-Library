// Orquestra o download real: bundle do B2 -> saidas (TXT/HTML) -> grava em disco.
// Sem acoplar a UI: recebe dados + callbacks de progresso.
import type { DownloadFormat } from "../core/types";
import {
  bundleToHtml,
  bundleToText,
  fetchBundle,
  type ExtractedBundle
} from "./bundle";
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

async function yieldToUi(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

async function createZip(
  files: Array<{ name: string; data: Uint8Array }>,
  onProgress?: (percent: number) => void
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const prepared: Array<{
    name: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }> = [];
  let offset = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    prepared.push({ name, data: file.data, crc, offset });
    offset += 30 + name.length + file.data.length;
    onProgress?.(Math.round((45 * (index + 1)) / Math.max(files.length, 1)));
    if (index % 8 === 7 || file.data.length >= 1024 * 1024) await yieldToUi();
  }

  const centralSize = prepared.reduce((sum, file) => sum + 46 + file.name.length, 0);
  const out = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (let index = 0; index < prepared.length; index += 1) {
    const file = prepared[index];
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(file.crc), ...u32(file.data.length), ...u32(file.data.length),
      ...u16(file.name.length), ...u16(0), ...file.name
    ]);
    out.set(localHeader, cursor);
    cursor += localHeader.length;
    out.set(file.data, cursor);
    cursor += file.data.length;
    onProgress?.(45 + Math.round((45 * (index + 1)) / Math.max(prepared.length, 1)));
    if (index % 8 === 7 || file.data.length >= 1024 * 1024) await yieldToUi();
  }

  const centralOffset = cursor;
  for (const file of prepared) {
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(file.crc), ...u32(file.data.length), ...u32(file.data.length),
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

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;
}

function referencedAssetNames(chapters: ExtractedBundle["chapters"]): Set<string> {
  const names = new Set<string>();
  for (const chapter of chapters) {
    for (const match of chapter.html.matchAll(/\.\.\/assets\/([a-zA-Z0-9._-]+)/g)) names.add(match[1]);
  }
  return names;
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

async function fetchEpubCover(coverUrl?: string): Promise<EpubCover | undefined> {
  if (!coverUrl) return undefined;
  try {
    const response = await fetch(coverUrl, { cache: "no-store" });
    if (!response.ok) return undefined;
    const contentType = response.headers.get("content-type") ?? "";
    const media = coverMediaType(contentType, coverUrl);
    if (!media) return undefined;
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.length === 0) return undefined;
    return { name: `cover.${media.ext}`, mediaType: media.mediaType, data };
  } catch {
    return undefined;
  }
}

async function buildEpub(
  bundle: ExtractedBundle,
  title: string,
  range?: { start: number; end: number },
  onProgress?: (percent: number) => void,
  cover?: EpubCover
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
      `<h1>${xmlEscape(chapter.title || `Capitulo ${chapter.number}`)}</h1>${chapter.html.replace(/<img([^>]*)>/gi, "<img$1 />")}`
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
    <dc:identifier id="book-id">oghma:${xmlEscape(title)}</dc:identifier>
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
  ], onProgress);
}

export async function buildOutputs(
  bundle: ExtractedBundle,
  title: string,
  formats: DownloadFormat[],
  range?: { start: number; end: number },
  onProgress?: (percent: number) => void,
  cover?: EpubCover
): Promise<Array<{ fileName: string; data: FileData }>> {
  const base = sanitizeFileName(title);
  const outputs: Array<{ fileName: string; data: FileData }> = [];
  if (formats.includes("EPUB")) {
    outputs.push({ fileName: `${base}.epub`, data: await buildEpub(bundle, title, range, onProgress, cover) });
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

export async function runDownload(
  req: DownloadRequest,
  opts: { save?: SaveFile; onProgress?: (percent: number) => void } = {}
): Promise<string[]> {
  const { onProgress } = opts;
  onProgress?.(5);
  if (!req.novel.bundleKey) throw new Error(`"${req.novel.title}" ainda nao tem bundle publicado`);
  const bundle = await fetchBundle(req.serverUrl, req.novel.bundleKey);
  onProgress?.(60);
  const cover = await fetchEpubCover(req.novel.coverUrl);
  const needsAzw3 = req.formats.includes("AZW3");
  const buildFormats = req.formats.filter((format) => format !== "AZW3");
  if (needsAzw3 && !buildFormats.includes("EPUB")) buildFormats.push("EPUB");
  const outputs = await buildOutputs(
    bundle,
    req.novel.title,
    buildFormats,
    req.range,
    (percent) => onProgress?.(60 + Math.round(percent * 0.2)),
    cover
  );
  onProgress?.(80);
  const save = opts.save ?? (await defaultSaveFile(req.outputDir));
  const savedFiles: string[] = [];
  const saveProgressRange = needsAzw3 ? 14 : 20;
  for (let i = 0; i < outputs.length; i += 1) {
    await save(outputs[i].fileName, outputs[i].data);
    savedFiles.push(outputs[i].fileName);
    await yieldToUi();
    onProgress?.(80 + Math.round((saveProgressRange * (i + 1)) / outputs.length));
  }
  if (needsAzw3) {
    onProgress?.(96);
    const azw3 = await convertLocalEpubToAzw3(req.novel.title, req.outputDir, savedFiles);
    if (!azw3) {
      throw new Error("Conversao AZW3 esta disponivel no app desktop.");
    }
    savedFiles.push(azw3);
  }
  onProgress?.(100);
  return Array.from(new Set(savedFiles));
}
