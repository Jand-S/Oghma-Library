// TS side of the export staging contract (Rust commands begin/commit/abort_export).
// A download is written into <outputRoot>/.oghma-staging/<novelId>-<ts> and only
// replaces the book folder atomically on commit, so a canceled or failed download
// never leaves a half-written or mixed folder behind.
//
// Outside Tauri (browser dev, tests) there is no staging: files go straight to
// <outputRoot>/<sanitized title>, commit and abort are no-ops.
import { isTauriRuntime } from "../core/windowControls";
import { sanitizeFileName } from "./downloadManager";
import { joinPath } from "./localFiles";

export type ExportStage = {
  stagingDir: string;
  finalDir: string;
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

export async function beginExport(outputRoot: string, novelId: string, title: string): Promise<ExportStage> {
  const invoke = await loadInvoke();
  if (!invoke) {
    const dir = joinPath(outputRoot, sanitizeFileName(title));
    return { stagingDir: dir, finalDir: dir };
  }
  return invoke<ExportStage>("begin_export", { outputRoot, novelId, title });
}

export async function commitExport(stage: ExportStage & { novelId: string }): Promise<void> {
  if (stage.stagingDir === stage.finalDir) return;
  const invoke = await loadInvoke();
  if (!invoke) return;
  await invoke<void>("commit_export", {
    stagingDir: stage.stagingDir,
    finalDir: stage.finalDir,
    novelId: stage.novelId
  });
}

export async function abortExport(stagingDir: string, finalDir?: string): Promise<void> {
  // Never delete the real book folder in the no-staging fallback.
  if (finalDir !== undefined && stagingDir === finalDir) return;
  const invoke = await loadInvoke();
  if (!invoke) return;
  await invoke<void>("abort_export", { stagingDir });
}

export type ExportStaging = {
  beginExport: typeof beginExport;
  commitExport: typeof commitExport;
  abortExport: typeof abortExport;
};

export const exportStaging: ExportStaging = { beginExport, commitExport, abortExport };
