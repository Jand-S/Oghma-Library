export type WindowAction = "minimize" | "maximize" | "close";

export function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * Runs a window action. Outside Tauri (browser, tests) it dispatches an
 * `oghma-window-action` CustomEvent instead, so the UI stays testable.
 * "maximize" toggles between maximized and restored.
 */
export async function runWindowAction(action: WindowAction) {
  if (!isTauriRuntime()) {
    window.dispatchEvent(new CustomEvent("oghma-window-action", { detail: action }));
    return;
  }

  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const current = getCurrentWindow();

  if (action === "minimize") await current.minimize();
  if (action === "maximize") await current.toggleMaximize();
  if (action === "close") await current.close();
}

/**
 * Calls `onChange` with the window's maximized state now and after every
 * resize. Returns an unsubscribe function. No-op outside Tauri.
 */
export function watchMaximized(onChange: (maximized: boolean) => void): () => void {
  if (!isTauriRuntime()) return () => undefined;
  let disposed = false;
  let unlisten: (() => void) | undefined;

  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const current = getCurrentWindow();
    const refresh = () => {
      void current.isMaximized().then((value) => {
        if (!disposed) onChange(value);
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
