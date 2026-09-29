export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(userAgent: string): Platform {
  if (/Mac|iPhone|iPad/i.test(userAgent)) return "macos";
  if (/Win/i.test(userAgent)) return "windows";
  return "linux";
}

/** Platform set on <html data-platform> by main.tsx; tests and browsers without it fall back to "linux". */
export function getPlatform(): Platform {
  if (typeof document === "undefined") return "linux";
  const value = document.documentElement.dataset.platform;
  return value === "macos" || value === "windows" ? value : "linux";
}

/** Writes data-platform on <html> so CSS can key off it. Call before the first render. */
export function applyPlatform(userAgent = navigator.userAgent) {
  const platform = detectPlatform(userAgent);
  document.documentElement.dataset.platform = platform;
  return platform;
}

/**
 * macOS only: mirrors native fullscreen on <html data-fullscreen>. Fullscreen hides the
 * traffic lights, so CSS drops the sidebar's top inset (--mac-inset-top) back to 0.
 * No-op outside Tauri (browser, tests). Returns an unsubscribe function.
 */
export function watchFullscreen(platform: Platform = getPlatform()): () => void {
  if (platform !== "macos" || typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const root = document.documentElement;

  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const current = getCurrentWindow();
    const refresh = () => {
      void current.isFullscreen().then((fullscreen) => {
        if (disposed) return;
        if (fullscreen) root.dataset.fullscreen = "";
        else delete root.dataset.fullscreen;
      }).catch(() => undefined);
    };
    refresh();
    const stop = await current.onResized(refresh);
    if (disposed) stop();
    else unlisten = stop;
  }).catch(() => undefined);

  return () => {
    disposed = true;
    unlisten?.();
  };
}
