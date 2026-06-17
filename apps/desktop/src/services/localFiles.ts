import { isTauriRuntime } from "../windowControls";

export type FileData = string | Uint8Array;

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
