import type { KindleDeviceStatus, LibraryMeta, QueueItem } from "../core/types";
import { isTauriRuntime } from "../core/windowControls";

export type FileData = string | Uint8Array;
export type LocalLibraryEntry = {
  title: string;
  outputDir: string;
  files: string[];
  coverUrl?: string;
  coverDataUrl?: string;
  sizeBytes: number;
};

type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;
type Invoke = <T>(
  command: string,
  args?: InvokeArgs,
  options?: { headers: Record<string, string> }
) => Promise<T>;

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
  const rows = await invoke<Array<{ title: string; output_dir: string; files: string[]; cover_path?: string | null; cover_data_url?: string | null; size_bytes: number }>>(
    "list_export_library",
    { outputDir }
  );
  return Promise.all(rows.map(async (row) => ({
    title: row.title,
    outputDir: row.output_dir,
    files: row.files,
    coverUrl: row.cover_data_url ?? (row.cover_path ? await filePathToAssetUrl(row.cover_path) : undefined),
    coverDataUrl: row.cover_data_url ?? undefined,
    sizeBytes: row.size_bytes
  })));
}

export async function listLibraryMetadata(): Promise<LibraryMeta[]> {
  const invoke = await loadInvoke();
  if (!invoke) return [];
  return invoke<LibraryMeta[]>("list_library_meta");
}

export async function saveLibraryMetadata(meta: LibraryMeta): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  await invoke("save_library_meta", { meta });
  return true;
}

export async function deleteLibraryMetadata(key: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
  await invoke("delete_library_meta", { key });
  return true;
}

export async function deleteLocalLibraryFiles(outputDir: string, itemDir: string): Promise<boolean> {
  const invoke = await loadInvoke();
  if (!invoke) return false;
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
  return invoke<{ sentIds: string[]; convertedFormat: "AZW3" }>("send_to_kindle", {
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      outputDir: item.outputDir,
      outputFiles: item.outputFiles
    }))
  });
}
