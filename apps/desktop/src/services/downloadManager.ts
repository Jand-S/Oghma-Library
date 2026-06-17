// Orquestra o download real: bundle do B2 -> saidas (TXT/HTML) -> grava em disco.
// Sem acoplar a UI: recebe dados + callbacks de progresso.
import { fetchBundle, bundleToHtml, bundleToText, type ExtractedBundle } from "./bundle";
import type { DownloadFormat } from "../types";

export type SaveFile = (fileName: string, data: string) => Promise<void>;

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

export function buildOutputs(
  bundle: ExtractedBundle,
  title: string,
  formats: DownloadFormat[],
  range?: { start: number; end: number }
): Array<{ fileName: string; data: string }> {
  const base = sanitizeFileName(title);
  const outputs: Array<{ fileName: string; data: string }> = [];
  if (formats.includes("TXT")) {
    outputs.push({ fileName: `${base}.txt`, data: bundleToText(title, bundle.chapters, range) });
  }
  // EPUB/PDF ainda nao implementados: geramos um HTML autocontido como base.
  if (formats.includes("EPUB") || formats.includes("PDF")) {
    outputs.push({ fileName: `${base}.html`, data: bundleToHtml(title, bundle.chapters, range) });
  }
  if (outputs.length === 0) {
    outputs.push({ fileName: `${base}.txt`, data: bundleToText(title, bundle.chapters, range) });
  }
  return outputs;
}

// Carrega o plugin de fs do Tauri sem quebrar o build quando ele nao esta instalado.
// (especificador em variavel => o tsc nao tenta resolver o modulo)
async function loadTauriFs(): Promise<{ writeTextFile: (p: string, c: string) => Promise<void> } | null> {
  try {
    const spec = "@tauri-apps/plugin-fs";
    const mod = (await import(/* @vite-ignore */ spec)) as {
      writeTextFile?: (p: string, c: string) => Promise<void>;
    };
    return mod.writeTextFile ? { writeTextFile: mod.writeTextFile } : null;
  } catch {
    return null;
  }
}

function browserDownload(fileName: string, data: string): void {
  const blob = new Blob([data], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Salvador padrao: usa o fs do Tauri (grava em outputDir) ou cai pro download do navegador.
export async function defaultSaveFile(outputDir: string): Promise<SaveFile> {
  const fs = await loadTauriFs();
  if (fs) {
    const dir = outputDir.replace(/[\\/]+$/, "");
    return async (fileName, data) => {
      await fs.writeTextFile(`${dir}/${fileName}`, data);
    };
  }
  return async (fileName, data) => browserDownload(fileName, data);
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
