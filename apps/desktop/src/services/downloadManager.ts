// Orquestra o download real: bundle do B2 -> saidas (TXT/HTML) -> grava em disco.
// Sem acoplar a UI: recebe dados + callbacks de progresso.
import { fetchBundle, bundleToHtml, bundleToText, type ExtractedBundle } from "./bundle";
import { saveLocalFile, type FileData } from "./localFiles";
import type { DownloadFormat } from "../types";

export type SaveFile = (fileName: string, data: FileData) => Promise<void>;

export type DownloadNovelInput = {
  id: string;
  title: string;
  bundleKey?: string;
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

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function createZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = enc.encode(file.name);
    const crc = crc32(file.data);
    const localHeader = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0), ...name
    ]);
    const local = concatBytes([localHeader, file.data]);
    locals.push(local);
    const central = new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0),
      ...u32(crc), ...u32(file.data.length), ...u32(file.data.length), ...u16(name.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset), ...name
    ]);
    centrals.push(central);
    offset += local.length;
  }

  const centralDir = concatBytes(centrals);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length),
    ...u32(centralDir.length), ...u32(offset), ...u16(0)
  ]);
  return concatBytes([...locals, centralDir, end]);
}

function xhtmlDoc(title: string, body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="pt-BR">
<head><title>${xmlEscape(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>${body}</body>
</html>`;
}

function buildEpub(bundle: ExtractedBundle, title: string, range?: { start: number; end: number }): Uint8Array {
  const enc = new TextEncoder();
  const chapters = bundle.chapters.filter((chapter) => !range || (chapter.number >= range.start && chapter.number <= range.end));
  const chapterFiles = chapters.map((chapter, index) => ({
    id: `chapter-${index + 1}`,
    href: `chapters/chapter-${index + 1}.xhtml`,
    title: chapter.title || `Capitulo ${chapter.number}`,
    html: xhtmlDoc(chapter.title || `Capitulo ${chapter.number}`, `<h1>${xmlEscape(chapter.title || `Capitulo ${chapter.number}`)}</h1>${chapter.html}`)
  }));
  const manifestItems = chapterFiles.map((file) => `<item id="${file.id}" href="${file.href}" media-type="application/xhtml+xml"/>`).join("\n    ");
  const spineItems = chapterFiles.map((file) => `<itemref idref="${file.id}"/>`).join("\n    ");
  const navItems = chapterFiles.map((file) => `<li><a href="${file.href}">${xmlEscape(file.title)}</a></li>`).join("\n      ");
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
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`) },
    { name: "OEBPS/nav.xhtml", data: enc.encode(xhtmlDoc("Sumario", `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>Sumario</h1><ol>${navItems}</ol></nav>`)) },
    { name: "OEBPS/style.css", data: enc.encode("body{font-family:serif;line-height:1.55;margin:5%;} h1{font-size:1.35em;} img{max-width:100%;height:auto;}") },
    ...chapterFiles.map((file) => ({ name: `OEBPS/${file.href}`, data: enc.encode(file.html) }))
  ]);
}

export function buildOutputs(
  bundle: ExtractedBundle,
  title: string,
  formats: DownloadFormat[],
  range?: { start: number; end: number }
): Array<{ fileName: string; data: FileData }> {
  const base = sanitizeFileName(title);
  const outputs: Array<{ fileName: string; data: FileData }> = [];
  if (formats.includes("EPUB")) {
    outputs.push({ fileName: `${base}.epub`, data: buildEpub(bundle, title, range) });
  }
  if (formats.includes("TXT")) {
    outputs.push({ fileName: `${base}.txt`, data: bundleToText(title, bundle.chapters, range) });
  }
  // PDF ainda nao tem renderizador real: mantemos HTML como base exportavel por enquanto.
  if (formats.includes("PDF")) {
    outputs.push({ fileName: `${base}.html`, data: bundleToHtml(title, bundle.chapters, range) });
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
  const outputs = buildOutputs(bundle, req.novel.title, req.formats, req.range);
  const save = opts.save ?? (await defaultSaveFile(req.outputDir));
  for (let i = 0; i < outputs.length; i += 1) {
    await save(outputs[i].fileName, outputs[i].data);
    onProgress?.(60 + Math.round((40 * (i + 1)) / outputs.length));
  }
  onProgress?.(100);
  return outputs.map((o) => o.fileName);
}
