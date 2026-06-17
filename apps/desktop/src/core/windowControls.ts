export function isTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

export async function runWindowAction(action: "minimize" | "maximize" | "close") {
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
