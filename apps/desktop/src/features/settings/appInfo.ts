import { version as packageVersion } from "../../../package.json";
import { isTauriRuntime } from "../../core/windowControls";

/** App version from Tauri (`getVersion`), falling back to package.json outside Tauri. */
export async function getAppVersion(): Promise<string> {
  if (!isTauriRuntime()) return packageVersion;
  try {
    const app = await import("@tauri-apps/api/app");
    const version = await app.getVersion();
    return typeof version === "string" && version ? version : packageVersion;
  } catch {
    return packageVersion;
  }
}

export const fallbackAppVersion = packageVersion;

/**
 * Opens an http(s) URL in the default browser. Inside Tauri it calls the opener plugin
 * (registered in Rust, `opener:default` allows http/https); elsewhere it opens a new tab.
 */
export async function openExternal(url: string): Promise<void> {
  if (isTauriRuntime()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("plugin:opener|open_url", { url });
      return;
    } catch {
      // Fall through to window.open.
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}
