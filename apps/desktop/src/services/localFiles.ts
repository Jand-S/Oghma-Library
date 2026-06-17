import { isTauriRuntime } from "../windowControls";
import type { KindleDeviceStatus, QueueItem } from "../types";

export type FileData = string | Uint8Array;
export type LocalLibraryEntry = {
  title: string;
  outputDir: string;
  files: string[];
  coverUrl?: string;
  sizeBytes: number;
};

type Invoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

async function loadInvoke(): Promise<Invoke | null> {
  if (!isTauriRuntime()) return null;
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.invoke as Invoke;
  } catch {
    return null;
  }
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
    await invoke("save_export_file", {
      outputDir,
      fileName,
      bytes: typeof data === "string" ? Array.from(new TextEncoder().encode(data)) : Array.from(data)
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

async function filePathToAssetUrl(path: string): Promise<string> {
  try {
    const mod = await import("@tauri-apps/api/core");
    return mod.convertFileSrc(path);
  } catch {
    return path;
  }
}

export async function listLocalLibrary(outputDir: string): Promise<LocalLibraryEntry[] | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  const rows = await invoke<Array<{ title: string; output_dir: string; files: string[]; cover_path?: string | null; size_bytes: number }>>(
    "list_export_library",
    { outputDir }
  );
  return Promise.all(rows.map(async (row) => ({
    title: row.title,
    outputDir: row.output_dir,
    files: row.files,
    coverUrl: row.cover_path ? await filePathToAssetUrl(row.cover_path) : undefined,
    sizeBytes: row.size_bytes
  })));
}

export async function detectKindleDevice(): Promise<KindleDeviceStatus | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<KindleDeviceStatus>("detect_kindle");
}

export async function sendItemsToKindle(items: QueueItem[]): Promise<{ sentIds: string[]; convertedFormat: "AZW3" } | null> {
  const invoke = await loadInvoke();
  if (!invoke) return null;
  return invoke<{ sentIds: string[]; convertedFormat: "AZW3" }>("send_to_kindle", {
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      outputDir: item.outputDir,
      outputFiles: item.outputFiles
    }))
  });
}
