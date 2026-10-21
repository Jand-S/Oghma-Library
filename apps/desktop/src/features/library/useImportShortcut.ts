import { useEffect, useRef } from "react";
import { importApi as defaultApi, type ImportApi } from "../../services/importClient";
import { getPlatform, type Platform } from "../../shell/platform";

/**
 * "Importar EPUB…" from anywhere: the macOS File menu (⌘O, a native accelerator that Rust turns
 * into an event) or Ctrl+O on Windows and Linux, which have no menu bar.
 */
export function useImportShortcut(onImport: () => void, api: ImportApi = defaultApi, platform: Platform = getPlatform()) {
  const onImportRef = useRef(onImport);
  onImportRef.current = onImport;

  useEffect(() => {
    if (!api.available) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void api.onMenuImport(() => onImportRef.current()).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [api]);

  useEffect(() => {
    // On the Mac the menu owns ⌘O; handling it here too would open the dialog twice.
    if (!api.available || platform === "macos") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "o") return;
      event.preventDefault();
      onImportRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [api, platform]);
}
