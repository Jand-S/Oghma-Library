import { useCallback, useEffect, useRef, useState } from "react";
import { isTauriRuntime } from "../../core/windowControls";

/** First check a little after launch (the app is busy booting), then every hour, and when the
 *  reader comes back to the window if the last check is older than FOCUS_RECHECK_MS. */
const FIRST_CHECK_MS = 15_000;
const RECHECK_MS = 60 * 60 * 1000;
const FOCUS_RECHECK_MS = 30 * 60 * 1000;

export type AppUpdateState =
  | { status: "idle" }
  | { status: "available"; version: string; notes: string; date?: string }
  | { status: "downloading"; version: string; notes: string; percent: number | null }
  | { status: "restarting"; version: string }
  | { status: "error"; version?: string; notes?: string; message: string };

type UpdateHandle = {
  version: string;
  body?: string;
  date?: string;
  downloadAndInstall: (onEvent?: (event: { event: string; data?: { contentLength?: number; chunkLength?: number } }) => void) => Promise<void>;
};

export type UpdaterApi = {
  check: () => Promise<UpdateHandle | null>;
  relaunch: () => Promise<void>;
};

async function tauriUpdater(): Promise<UpdaterApi | null> {
  if (!isTauriRuntime()) return null;
  try {
    const [{ check }, { relaunch }] = await Promise.all([import("@tauri-apps/plugin-updater"), import("@tauri-apps/plugin-process")]);
    return { check: () => check() as Promise<UpdateHandle | null>, relaunch };
  } catch {
    return null;
  }
}

/**
 * Over-the-air updates (Tauri updater, signed with the Oghma key). Checks quietly a little after
 * launch, every hour and on coming back to the window (at most every 30 min); when a newer version exists the header shows a button. Installing
 * downloads the signed package, swaps the app and relaunches it. Failed checks stay silent.
 */
export function useAppUpdate(api?: UpdaterApi | null) {
  const [state, setState] = useState<AppUpdateState>({ status: "idle" });
  const update = useRef<UpdateHandle | null>(null);
  const apiRef = useRef<Promise<UpdaterApi | null>>(api !== undefined ? Promise.resolve(api) : tauriUpdater());

  const lastCheck = useRef(0);

  const checkNow = useCallback(async () => {
    const updater = await apiRef.current;
    if (!updater) return;
    lastCheck.current = Date.now();
    try {
      const found = await updater.check();
      if (!found) return;
      update.current = found;
      setState((current) => (current.status === "downloading" || current.status === "restarting"
        ? current
        : { status: "available", version: found.version, notes: found.body ?? "", date: found.date }));
    } catch {
      // Offline or server down: try again on the next round.
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => void checkNow(), FIRST_CHECK_MS);
    const again = window.setInterval(() => void checkNow(), RECHECK_MS);
    const onFocus = () => {
      if (lastCheck.current && Date.now() - lastCheck.current >= FOCUS_RECHECK_MS) void checkNow();
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(again);
      window.removeEventListener("focus", onFocus);
    };
  }, [checkNow]);

  const install = useCallback(async () => {
    const found = update.current;
    const updater = await apiRef.current;
    if (!found || !updater) return;
    const notes = found.body ?? "";
    let total = 0;
    let received = 0;
    setState({ status: "downloading", version: found.version, notes, percent: null });
    try {
      await found.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data?.contentLength ?? 0;
        if (event.event === "Progress") {
          received += event.data?.chunkLength ?? 0;
          setState({ status: "downloading", version: found.version, notes, percent: total ? Math.min(100, Math.round((received / total) * 100)) : null });
        }
      });
      setState({ status: "restarting", version: found.version });
      await updater.relaunch();
    } catch (error) {
      setState({ status: "error", version: found.version, notes, message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  return { state, checkNow, install };
}

export type AppUpdateController = ReturnType<typeof useAppUpdate>;
