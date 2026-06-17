// Motor de download/extração de bundles publicados no B2/CDN.
// Bundle = tar.gz com `meta.json` + `chapters/<n>.html` (ver backend/publish/bundles.py).
// Tudo em TS puro: gunzip nativo (DecompressionStream) + untar minimalista, sem dependencias.

export type BundleChapter = { number: number; title?: string; html: string };

export type BundleMeta = {
  id?: string;
  source_id?: string;
  slug?: string;
  title?: string;
  bundle_version?: number;
  generated_at?: string;
  chapters?: Array<{ number: number; title?: string; file?: string; words?: number }>;
};

export type ExtractedBundle = { meta: BundleMeta | null; chapters: BundleChapter[] };

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

export function extractBundle(tarBytes: Uint8Array): ExtractedBundle {
  const dec = new TextDecoder();
  let meta: BundleMeta | null = null;
  const chapters: BundleChapter[] = [];
  for (const entry of untar(tarBytes)) {
    if (entry.name === "meta.json") {
      try {
        meta = JSON.parse(dec.decode(entry.data)) as BundleMeta;
      } catch {
        meta = null;
      }
    } else {
      const m = entry.name.match(/^chapters\/([0-9.]+)\.html$/);
      if (m) chapters.push({ number: Number(m[1]), html: dec.decode(entry.data) });
    }
  }
  chapters.sort((a, b) => a.number - b.number);
  if (meta?.chapters) {
    const titles = new Map(meta.chapters.map((c) => [c.number, c.title]));
    for (const ch of chapters) ch.title = titles.get(ch.number);
  }
  return { meta, chapters };
}

function trimBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

// Baixa e extrai o bundle de uma novel. `bundleKey` vem do catalogo
// (ex.: content/central-novel/<slug>/<slug>.v1.tar.gz).
export async function fetchBundle(serverUrl: string, bundleKey: string): Promise<ExtractedBundle> {
  const url = `${trimBase(serverUrl)}/${bundleKey.replace(/^\/+/, "")}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar ${url}`);
  const tarBytes = await gunzip(await res.arrayBuffer());
  return extractBundle(tarBytes);
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
      return `<section class="chapter"><h2>${esc(head)}</h2>${c.html}</section>`;
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
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${body}
</body>
</html>
`;
}
