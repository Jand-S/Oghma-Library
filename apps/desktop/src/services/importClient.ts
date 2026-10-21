import { isTauriRuntime } from "../core/windowControls";
import { loadInvoke } from "./localFiles";

// Typed wrappers over the EPUB import and account-file commands (docs/IMPORT_EPUB.md,
// "Comandos Tauri"). The webview never sees file paths: Rust keeps them and hands out ids.

/** A file the reader picked or dropped; its path stays on the Rust side. */
export type PickedFile = { id: string; fileName: string; size: number };

/** Where the preview found the series. */
export type SeriesSource = "calibre" | "epub3" | "filename";

export type ImportSeries = { id: string; name: string; volume: number | null };

export type ImportPreview = {
  id: string;
  fileName: string;
  sha256: string;
  size: number;
  title: string;
  author: string | null;
  language: string | null;
  series: ImportSeries | null;
  seriesSource: SeriesSource | null;
  /** The EPUB's own cover as a data URL (thumbnail up to 600px). */
  coverDataUrl: string | null;
  /** Library book whose cover the commit would reuse (another volume of the series). */
  coverFromLibrary: string | null;
  alreadyImported: { outputDir: string } | null;
  /** Invalid EPUB: the item cannot be imported. */
  error: string | null;
};

export type ImportCommitItem = {
  id: string;
  title: string;
  author: string;
  /** Rust works out the series id from the name. */
  series: { name: string; volume: number | null } | null;
  /** PNG bytes of the generated cover; only used when the EPUB and the series have none. */
  coverPng: number[] | null;
};

export type ImportResult = { id: string; key: string; outputDir: string | null; error: string | null };

export type UploadResult = { key: string; state: "uploaded" | "already" | "failed"; error: string | null };

export type DownloadResult = { key: string; outputDir: string | null; error: string | null };

export type AccountFilesUsage = { usedBytes: number; quotaBytes: number; files: number };

export type AccountFileProgress = { key: string; sent: number; total: number };

/** Library key of an imported book: `import:<sha256>`. */
export function importKey(sha256: string) {
  return `import:${sha256}`;
}

export function isImportKey(id: string | null | undefined): boolean {
  return Boolean(id?.startsWith("import:"));
}

export type ImportApi = {
  /** False outside the desktop app (browser build, tests without a fake). */
  available: boolean;
  /** Native dialog, several files, `.epub` only. */
  pick(): Promise<PickedFile[]>;
  preview(ids: string[]): Promise<ImportPreview[]>;
  commit(items: ImportCommitItem[]): Promise<ImportResult[]>;
  upload(key: string): Promise<UploadResult>;
  download(key: string, title: string): Promise<DownloadResult>;
  usage(): Promise<AccountFilesUsage>;
  /** `.epub` files dropped anywhere on the window. */
  onDropped(handler: (files: PickedFile[]) => void): Promise<() => void>;
  onFileProgress(handler: (progress: AccountFileProgress) => void): Promise<() => void>;
};

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const invoke = await loadInvoke();
  if (!invoke) throw new Error("unavailable");
  return invoke<T>(command, args);
}

async function listenTo<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  if (!isTauriRuntime()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (message) => handler(message.payload));
}

/** App-wide import API over Tauri IPC. */
export const importApi: ImportApi = {
  get available() {
    return isTauriRuntime();
  },
  pick: () => call<PickedFile[]>("import_epub_pick"),
  preview: (ids) => call<ImportPreview[]>("import_epub_preview", { ids }),
  commit: (items) => call<ImportResult[]>("import_epub_commit", { items }),
  upload: (key) => call<UploadResult>("account_file_upload", { key }),
  download: (key, title) => call<DownloadResult>("account_file_download", { key, title }),
  usage: () => call<AccountFilesUsage>("account_files_usage"),
  onDropped: (handler) => listenTo<PickedFile[]>("import-epub-dropped", handler),
  onFileProgress: (handler) => listenTo<AccountFileProgress>("account-file-progress", handler)
};
