import type { ICloudSaveResult, ICloudStatus, KindleDeviceStatus, LibraryMeta, QueueItem } from "../core/types";
import { isTauriRuntime } from "../core/windowControls";

export type FileData = string | Uint8Array;
export type LocalLibraryEntry = {
  /** Display title: manifest title (with accents) when present, else the folder name. */
  title: string;
  /** Folder name inside the output root (sanitized title). */
  folderName: string;
  outputDir: string;
  files: string[];
  /** Ready-to-render cover URL (asset protocol with `?v=mtime`, or the legacy data URL). */
  coverUrl?: string;
  coverPath?: string;
  coverDataUrl?: string;
  sizeBytes: number;
  mtimeMs?: number;
  novelId?: string;
  generatedAt?: string;
  chapterCount?: number;
  sourceChars?: number;
  wordCount?: number;
  analysisFormat?: string;
  /** "pt-BR" for books produced by the translation screen. */
  language?: string;
  sourceNovelId?: string;
  /** 0–99 while the translated book is a preview (only finished chapters). */
  translationProgress?: number;
  /** Downloaded as a chapter range (new chapters do not apply). */
  partialRange?: boolean;
};

/** Raw `ExportLibraryItem` returned by the Rust `list_export_library` command. */
export type ExportLibraryRow = {
  title: string;
  folderName?: string | null;
  outputDir: string;
  files: string[];
  coverPath?: string | null;
  coverDataUrl?: string | null;
  sizeBytes: number;
  mtimeMs?: number | null;
  novelId?: string | null;
  generatedAt?: string | null;
  chapterCount?: number | null;
  sourceChars?: number | null;
  wordCount?: number | null;
  analysisFormat?: string | null;
  language?: string | null;
  sourceNovelId?: string | null;
  translationProgress?: number | null;
  partialRange?: boolean | null;
};

type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;
type Invoke = <T>(
  command: string,
  args?: InvokeArgs,
  options?: { headers: Record<string, string> }
) => Promise<T>;

type TauriCore = typeof import("@tauri-apps/api/core");
let tauriCore: Promise<TauriCore> | null = null;

/** Imports `@tauri-apps/api/core` once and shares the module between concurrent callers. */
function loadTauriCore(): Promise<TauriCore> {
  tauriCore ??= import("@tauri-apps/api/core").catch((error: unknown) => {
    tauriCore = null;
    throw error;
  });
  return tauriCore;
}

async function loadInvoke(): Promise<Invoke | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await loadTauriCore();
    return mod.invoke as Invoke;
  } catch {
    return null;
  }
}

// ---- Output root (pasta de saída) on the Rust side: src-tauri/src/export_root.rs ----
// File commands only accept paths inside the root Rust keeps. The webview can set it the first
// time and later only to a missing, empty or Oghma folder; "Escolher…" uses a dialog opened by
// Rust, which may point anywhere the user picks.
let confirmedExportRoot: string | null = null;

/** Tells Rust that `path` is the output root. Throws with Rust's message when it refuses. */
export async function setExportRoot(path: string): Promise<void> {
  const invoke = await loadInvoke();
  if (!invoke) return;
  await invoke<string>("export_root_set", { path });
  confirmedExportRoot = path;
}

/** Calls `setExportRoot` once per path (before listing, cleaning or exporting into it). */
export async function ensureExportRoot(path: string): Promise<void> {
  if (confirmedExportRoot === path || !path.trim()) return;
  await setExportRoot(path);
}

/** Native folder dialog opened by Rust; the chosen folder becomes the root. Null when canceled. */
export async function pickExportRoot(options: { defaultPath?: string; title?: string } = {}): Promise<string | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  const picked = await invoke<string | null>("export_root_pick", { title: options.title ?? null, defaultPath: options.defaultPath ?? null });
  if (picked) confirmedExportRoot = picked;
  return picked;
}

export function joinPath(...parts: string[]): string {
  const filtered = parts
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part.replace(/[\\/]+$/, "") : part.replace(/^[\\/]+|[\\/]+$/g, "")));
  return filtered.join("/");
}

export async function saveLocalFile(outputDir: string, fileName: string, data: FileData): Promise<void> {
  const invoke = await loadInvoke();
  if (invoke) {
    const enc = new TextEncoder();
    const bytes = typeof data === "string" ? enc.encode(data) : data;
    await invoke("save_export_file", bytes, {
      headers: {
        "x-oghma-output-dir": encodeURIComponent(outputDir),
        "x-oghma-file-name": encodeURIComponent(fileName)
      }
    });
    return;
  }

  const blobPart = typeof data === "string" ? data : data.slice().buffer;
  const blob = new Blob([blobPart], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function openLocalPath(path: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  await invoke("open_local_path", { path });
  return true;
}

type ConvertFileSrc = (path: string) => string;

async function loadConvertFileSrc(): Promise<ConvertFileSrc | null> {
  try {
    const mod = await loadTauriCore();
    return mod.convertFileSrc;
  } catch {
    return null;
  }
}

/** Cover URL for a library row: asset-protocol URL with mtime cache-busting, else the data URL. */
export function coverUrlForRow(row: ExportLibraryRow, convertFileSrc: ConvertFileSrc | null): string | undefined {
  if (row.coverPath && convertFileSrc) {
    const url = convertFileSrc(row.coverPath);
    return row.mtimeMs ? `${url}${url.includes("?") ? "&" : "?"}v=${row.mtimeMs}` : url;
  }
  return row.coverDataUrl ?? undefined;
}

export function mapLibraryRow(row: ExportLibraryRow, convertFileSrc: ConvertFileSrc | null): LocalLibraryEntry {
  return {
    title: row.title,
    folderName: row.folderName ?? row.title,
    outputDir: row.outputDir,
    files: row.files,
    coverUrl: coverUrlForRow(row, convertFileSrc),
    coverPath: row.coverPath ?? undefined,
    coverDataUrl: row.coverDataUrl ?? undefined,
    sizeBytes: row.sizeBytes,
    mtimeMs: row.mtimeMs ?? undefined,
    novelId: row.novelId ?? undefined,
    generatedAt: row.generatedAt ?? undefined,
    chapterCount: row.chapterCount ?? undefined,
    sourceChars: row.sourceChars ?? undefined,
    wordCount: row.wordCount ?? undefined,
    analysisFormat: row.analysisFormat ?? undefined,
    language: row.language ?? undefined,
    sourceNovelId: row.sourceNovelId ?? undefined,
    translationProgress: row.translationProgress ?? undefined,
    partialRange: row.partialRange ?? undefined
  };
}

/**
 * Library metadata is keyed by `novel:<id>` when the folder has a manifest id, and by
 * the folder path otherwise (legacy). App code still passes the folder path as the key;
 * this map (filled by `listLocalLibrary`) lets save/delete translate it.
 */
const novelIdByOutputDir = new Map<string, string>();

export function novelMetaKey(novelId: string): string {
  return `novel:${novelId}`;
}

export async function listLocalLibrary(
  outputDir: string,
  options: { includeCoverData?: boolean } = {}
): Promise<LocalLibraryEntry[] | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  await ensureExportRoot(outputDir);
  const rows = await invoke<ExportLibraryRow[]>("list_export_library", {
    outputDir,
    includeCoverData: options.includeCoverData ?? false
  });
  const convertFileSrc = await loadConvertFileSrc();
  const entries = rows.map((row) => mapLibraryRow(row, convertFileSrc));
  for (const entry of entries) {
    if (entry.novelId) novelIdByOutputDir.set(entry.outputDir, entry.novelId);
  }
  return entries;
}

/** Removes leftover `.oghma-staging` / `.oghma-trash` entries (crash leftovers) under the output root. */
export async function prepareExportRoot(outputRoot: string): Promise<number | null> {
  const invoke = await loadInvoke();
  if (!invoke || !outputRoot.trim()) return null;
  await ensureExportRoot(outputRoot);
  return invoke<number>("cleanup_export_root", { outputRoot });
}

/** Native folder picker. Returns null when cancelled or outside Tauri. */
export async function pickDirectory(options: { defaultPath?: string; title?: string } = {}): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  try {
    const dialog = await import("@tauri-apps/plugin-dialog");
    const selected = await dialog.open({ directory: true, multiple: false, ...options });
    return typeof selected === "string" ? selected : null;
  } catch {
    return null;
  }
}

export async function listLibraryMetadata(): Promise<LibraryMeta[]> {
  const invoke = await loadInvoke();
  if (!invoke) return [];
  return invoke<LibraryMeta[]>("list_library_meta");
}

export async function saveLibraryMetadata(meta: LibraryMeta): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  const novelId = novelIdByOutputDir.get(meta.key);
  if (novelId) {
    // Write the stable key and drop the legacy folder-path row in one transaction.
    await invoke("save_library_meta", { meta: { ...meta, key: novelMetaKey(novelId) }, legacyKey: meta.key });
  } else {
    await invoke("save_library_meta", { meta });
  }
  return true;
}

export async function deleteLibraryMetadata(key: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  const novelId = novelIdByOutputDir.get(key);
  await invoke("delete_library_meta", { key });
  if (novelId) {
    await invoke("delete_library_meta", { key: novelMetaKey(novelId) });
    novelIdByOutputDir.delete(key);
  }
  return true;
}

export async function deleteLocalLibraryFiles(outputDir: string, itemDir: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  await ensureExportRoot(outputDir);
  await invoke("delete_export_library_item", { outputDir, itemDir });
  return true;
}

export async function convertLocalEpubToAzw3(title: string, outputDir: string, outputFiles: string[]): Promise<string | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  const result = await invoke<{ fileName: string }>("convert_export_to_azw3", {
    title,
    outputDir,
    outputFiles
  });
  return result.fileName;
}

export async function detectKindleDevice(): Promise<KindleDeviceStatus | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<KindleDeviceStatus>("detect_kindle");
}

export async function sendItemsToKindle(items: QueueItem[]): Promise<{ sentIds: string[]; convertedFormat: "AZW3" } | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<{ sentIds: string[]; convertedFormat: "AZW3" }>("send_to_kindle", { items: bookFiles(items) });
}

/** The item fields the Kindle and iCloud commands read (`CloudItem`/`SendKindleItem` in Rust). */
function bookFiles(items: QueueItem[]) {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    outputDir: item.outputDir,
    outputFiles: item.outputFiles
  }));
}

/** Opens Amazon's "Send to Kindle" app with each book's EPUB; the user confirms the send there. */
export async function sendItemsToKindleWireless(items: QueueItem[]): Promise<{ openedIds: string[] } | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<{ openedIds: string[] }>("kindle_send_wireless", { items: bookFiles(items) });
}

export async function getICloudStatus(): Promise<ICloudStatus | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<ICloudStatus>("icloud_status");
}

/** Copies each book's EPUB to `<iCloud Drive>/<folder>`, replacing older copies. */
export async function saveItemsToICloud(items: QueueItem[], folder: string): Promise<ICloudSaveResult | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<ICloudSaveResult>("icloud_save", { items: bookFiles(items), folder });
}

/** Shows a file saved in iCloud Drive in Finder. */
export async function revealInICloud(path: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  await invoke("icloud_reveal", { path });
  return true;
}

