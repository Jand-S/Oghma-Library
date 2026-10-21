import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LibraryItem } from "../../core/types";
import { importApi as defaultApi, type AccountFilesUsage, type ImportApi } from "../../services/importClient";
import { accountFileReason, accountFilesStrings } from "../../strings/accountFiles";
import type { ToastTone } from "../../ui";
import { isShelf } from "./libraryModel";
import { isImported } from "./seriesModel";

/**
 * Where an imported book stands with the account: "local" (signed out: only on this computer),
 * "queued"/"sending"/"uploaded"/"failed" for the upload, "downloading" for "Baixar da conta".
 */
export type AccountFilePhase = "local" | "queued" | "sending" | "uploaded" | "failed" | "downloading";

export type AccountFileState = { phase: AccountFilePhase; percent?: number | null; error?: string | null };

/** Failures that sending again will not fix by itself: the sync does not retry them (the reader can). */
const PERMANENT_ERRORS = new Set(["file_too_large", "files_disabled", "quota_exceeded"]);

type AccountFilesArgs = {
  /** Signed in to the Oghma account; without it imported books stay "Só neste computador". */
  signedIn: boolean;
  /** When the account's library sync last finished: local imports not sent yet go up after it. */
  lastSyncAt: number | null;
  library: LibraryItem[];
  refreshLibrary: () => void;
  notify: (message: string, tone?: ToastTone) => void;
  /** Tests pass a fake; the app uses the Tauri commands. */
  api?: ImportApi;
};

export type AccountFilesController = {
  available: boolean;
  /** The account state of an imported book (null for catalog books and when there is nothing to say). */
  stateOf: (item: LibraryItem) => AccountFileState | null;
  /** Sends imported books to the account in the background, one at a time (no-op signed out). */
  upload: (keys: string[]) => void;
  /** "Tentar de novo": sends the failed ones of these books again and reports the outcome. */
  retry: (items: LibraryItem[]) => void;
  /** "Baixar da conta": a library row without files on this computer. Never the catalog download. */
  download: (item: LibraryItem) => Promise<void>;
  usage: () => Promise<AccountFilesUsage>;
};

function errorCodeOf(failure: unknown) {
  return failure instanceof Error ? failure.message : typeof failure === "string" ? failure : null;
}

/**
 * Imported books and the account (docs/IMPORT_EPUB.md, "Envio para a conta"): uploads after an
 * import and after each sync (books with a folder here that did not go up yet), the per-book
 * badge state, "Baixar da conta" for rows without a folder, and the quota for Ajustes.
 */
export function useAccountFiles({ signedIn, lastSyncAt, library, refreshLibrary, notify, api = defaultApi }: AccountFilesArgs): AccountFilesController {
  const [states, setStates] = useState<Record<string, AccountFileState>>({});
  const statesRef = useRef(states);
  statesRef.current = states;
  const libraryRef = useRef(library);
  libraryRef.current = library;
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  // Uploads run one after the other; `busy` holds the keys queued or sending.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const busy = useRef(new Set<string>());
  // Bumped on sign out: queued uploads of the old session do not run, and one still sending when
  // it ends leaves no state behind (another account may be signed in by then).
  const session = useRef(0);

  const setState = useCallback((key: string, state: AccountFileState | null) => {
    setStates((current) => {
      const next = { ...current };
      if (state) next[key] = state;
      else delete next[key];
      return next;
    });
  }, []);

  const enqueue = useCallback((keys: string[], announce: boolean) => {
    if (!api.available || !signedInRef.current) return;
    const started = session.current;
    for (const key of keys) {
      if (busy.current.has(key)) continue;
      busy.current.add(key);
      setState(key, { phase: "queued" });
      chain.current = chain.current.then(async () => {
        if (session.current !== started) return;
        setState(key, { phase: "sending", percent: null });
        let error: string | null = null;
        try {
          const result = await api.upload(key);
          if (result.state === "failed") error = result.error ?? "failed";
        } catch (failure) {
          error = errorCodeOf(failure) ?? "failed";
        }
        if (session.current !== started) return;
        busy.current.delete(key);
        setState(key, error === null ? { phase: "uploaded" } : { phase: "failed", error });
        if (error === null || !announce) return;
        const title = libraryRef.current.find((item) => item.novelId === key)?.title ?? key;
        notify(accountFilesStrings.failedUpload(title, accountFileReason(error)), "warning");
      });
    }
  }, [api, notify, setState]);

  const upload = useCallback((keys: string[]) => enqueue(keys, false), [enqueue]);

  const retry = useCallback((items: LibraryItem[]) => {
    const keys = items
      .filter((item) => isImported(item) && statesRef.current[item.novelId!]?.phase === "failed")
      .map((item) => item.novelId!);
    enqueue(keys, true);
  }, [enqueue]);

  // Signing out forgets what this session knew (another account may sign in next).
  useEffect(() => {
    if (signedIn) return;
    session.current += 1;
    busy.current.clear();
    setStates((current) => (Object.values(current).some((state) => state.phase !== "downloading") ? {} : current));
  }, [signedIn]);

  // After each sync: imported books with a folder here that are not in the account yet (or
  // failed for a passing reason) go up. Already-stored files cost one request ("already").
  // Books that show up later (the folder scan finishing after the sync, a new import) go up
  // when the library changes; failures wait for the next sync.
  const retriedAt = useRef<number | null>(null);
  useEffect(() => {
    if (!signedIn || lastSyncAt === null) return;
    const afterSync = retriedAt.current !== lastSyncAt;
    retriedAt.current = lastSyncAt;
    const keys = library
      .filter((item) => isImported(item) && !isShelf(item) && item.outputDir)
      .map((item) => item.novelId!)
      .filter((key) => {
        const state = statesRef.current[key];
        return !state || (afterSync && state.phase === "failed" && !PERMANENT_ERRORS.has(state.error ?? ""));
      });
    if (keys.length) upload([...new Set(keys)]);
  }, [lastSyncAt, library, signedIn, upload]);

  // Progress of the upload or download running now ("account-file-progress").
  useEffect(() => {
    if (!api.available) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void api.onFileProgress(({ key, sent, total }) => {
      setStates((current) => {
        const state = current[key];
        if (!state || (state.phase !== "sending" && state.phase !== "downloading") || total <= 0) return current;
        return { ...current, [key]: { ...state, percent: Math.min(100, (sent / total) * 100) } };
      });
    }).then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    }).catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [api]);

  const download = useCallback(async (item: LibraryItem) => {
    const key = item.novelId;
    if (!key || !isImported(item) || statesRef.current[key]?.phase === "downloading") return;
    setState(key, { phase: "downloading", percent: null });
    let error: string | null = null;
    try {
      const result = await api.download(key, item.title);
      error = result.error;
    } catch (failure) {
      error = errorCodeOf(failure) ?? "failed";
    }
    if (error !== null) {
      setState(key, null);
      notify(accountFilesStrings.failedDownload(item.title, accountFileReason(error)), "danger");
      return;
    }
    // It came from the account, so it is there already.
    setState(key, { phase: "uploaded" });
    refreshLibrary();
    notify(accountFilesStrings.downloaded(item.title), "success");
  }, [api, notify, refreshLibrary, setState]);

  const stateOf = useCallback((item: LibraryItem): AccountFileState | null => {
    if (!isImported(item)) return null;
    const state = states[item.novelId!] ?? null;
    if (isShelf(item)) return state?.phase === "downloading" ? state : null;
    if (!api.available) return null;
    if (!signedIn) return { phase: "local" };
    return state?.phase === "downloading" ? null : state;
  }, [api.available, signedIn, states]);

  const usage = useCallback(() => api.usage(), [api]);

  return useMemo(
    () => ({ available: api.available, stateOf, upload, retry, download, usage }),
    [api.available, download, retry, stateOf, upload, usage]
  );
}
