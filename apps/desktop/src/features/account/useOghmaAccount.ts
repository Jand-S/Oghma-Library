import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_ACCOUNT_SERVER,
  errorCode,
  isOk,
  type AccountClient,
  type AccountSessionInfo,
  type AccountUser,
  type ApiError
} from "../../services/accountClient";
import { AccountUnauthorized, syncLibrary } from "../../services/librarySync";
import { onLibraryMetaWrite } from "../../services/localFiles";

const SERVER_KEY = "oghma.account.server";
const CURSOR_PREFIX = "oghma.account.cursor.";
/** Changes made in the app go up after this pause (several quick edits = one round). */
const PUSH_DEBOUNCE_MS = 2500;
/** Coming back to the window pulls what other devices changed, at most this often. */
const FOCUS_MIN_INTERVAL_MS = 60_000;
const PERIODIC_MS = 5 * 60_000;

export type AccountStatus = "unavailable" | "loading" | "signedOut" | "signedIn";
export type SyncState = { state: "idle" | "syncing" | "error"; lastSyncAt: number | null; error?: string };

/** `{ ok: true, ...}` or `{ ok: false, error: <api code>, ...details }`. */
export type Outcome<T = object> = ({ ok: true } & T) | ({ ok: false; error: string } & Partial<ApiError>);

function readStorage(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not remembered; the next sync starts from the beginning (harmless).
  }
}

function failure(result: { status: number; body: unknown }): Outcome<never> {
  const body = (result.body ?? {}) as ApiError;
  return { ok: false, ...body, error: errorCode(result) };
}

function networkFailure(): Outcome<never> {
  return { ok: false, error: "network" };
}

type Options = {
  client: AccountClient;
  /** The account changed this computer's library (rows pulled): rescan it. */
  onLibraryChanged: () => void;
  /** Toasts for background events (session expired). */
  notify?: (message: string, tone?: "info" | "success" | "warning" | "danger") => void;
};

/**
 * The Oghma account: sign-in by e-mail code, the profile (nickname + avatar), connected devices
 * and the library sync. The token stays in Rust; this hook only sees statuses and JSON.
 * Sync runs after sign-in, after local changes (debounced), when the window regains focus and
 * every few minutes; a 401 signs the reader out.
 */
export function useOghmaAccount({ client, onLibraryChanged, notify }: Options) {
  const [status, setStatus] = useState<AccountStatus>(client.available ? "loading" : "unavailable");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [serverUrl, setServerUrlState] = useState(() => readStorage(SERVER_KEY) || DEFAULT_ACCOUNT_SERVER);
  const [sync, setSync] = useState<SyncState>({ state: "idle", lastSyncAt: null });
  const syncing = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const lastSyncAt = useRef(0);
  const userRef = useRef<AccountUser | null>(null);
  userRef.current = user;
  const onChangedRef = useRef(onLibraryChanged);
  onChangedRef.current = onLibraryChanged;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const signOutLocally = useCallback(() => {
    setUser(null);
    setStatus("signedOut");
    setSync({ state: "idle", lastSyncAt: null });
  }, []);

  const runSync = useCallback(async (joinAccount = false): Promise<void> => {
    const current = userRef.current;
    if (!current) return;
    if (syncing.current) {
      // A round is running: run once more after it (the change may have come too late for it).
      again.current = true;
      return syncing.current;
    }
    const cursorKey = CURSOR_PREFIX + current.publicId;
    const round = (async () => {
      setSync((value) => ({ ...value, state: "syncing", error: undefined }));
      try {
        const cursor = joinAccount ? 0 : Number(readStorage(cursorKey) ?? 0) || 0;
        const result = await syncLibrary(client, cursor, { joinAccount });
        writeStorage(cursorKey, String(result.cursor));
        lastSyncAt.current = Date.now();
        setSync({ state: "idle", lastSyncAt: lastSyncAt.current });
        if (result.applied > 0) onChangedRef.current();
      } catch (error) {
        if (error instanceof AccountUnauthorized) {
          signOutLocally();
          notifyRef.current?.("Sua sessão da conta Oghma expirou. Entre de novo para sincronizar.", "warning");
          return;
        }
        setSync((value) => ({ ...value, state: "error", error: error instanceof Error ? error.message : String(error) }));
      }
    })();
    syncing.current = round;
    try {
      await round;
    } finally {
      syncing.current = null;
      if (again.current) {
        again.current = false;
        void runSync();
      }
    }
  }, [client, signOutLocally]);

  // Boot: a saved session loads the profile and syncs.
  useEffect(() => {
    if (!client.available) return;
    let cancelled = false;
    void (async () => {
      try {
        const saved = await client.status();
        if (!saved.signedIn) {
          if (!cancelled) setStatus("signedOut");
          return;
        }
        if (saved.baseUrl) setServerUrlState(saved.baseUrl);
        const me = await client.api<AccountUser>("GET", "/v1/me");
        if (cancelled) return;
        if (me.status === 401) return signOutLocally();
        if (!isOk(me)) {
          // Offline or server down: stay signed in with no profile yet; a later sync retries.
          setStatus("signedIn");
          setSync((value) => ({ ...value, state: "error", error: errorCode(me) }));
          return;
        }
        setUser(me.body);
        userRef.current = me.body;
        setStatus("signedIn");
        void runSync();
      } catch {
        if (!cancelled) setStatus("signedOut");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, runSync, signOutLocally]);

  // Local edits go up (debounced); focus and a slow timer bring other devices' changes down.
  useEffect(() => {
    if (status !== "signedIn" || !user) return;
    let timer: number | undefined;
    const unsubscribe = onLibraryMetaWrite(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => void runSync(), PUSH_DEBOUNCE_MS);
    });
    const onFocus = () => {
      if (Date.now() - lastSyncAt.current >= FOCUS_MIN_INTERVAL_MS) void runSync();
    };
    window.addEventListener("focus", onFocus);
    const periodic = window.setInterval(() => void runSync(), PERIODIC_MS);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
      window.clearInterval(periodic);
    };
  }, [runSync, status, user]);

  const requestCode = useCallback(async (email: string): Promise<Outcome<{ email: string; resendIn: number; loginId: string | null }>> => {
    try {
      const result = await client.requestCode(serverUrl, email);
      if (!isOk(result)) return failure(result);
      return {
        ok: true,
        email: result.body.email ?? email.trim().toLowerCase(),
        resendIn: result.body.resendIn ?? 60,
        loginId: result.body.loginId ?? null
      };
    } catch {
      return networkFailure();
    }
  }, [client, serverUrl]);

  /** A successful sign-in (code or e-mail button): the books on this computer join the account. */
  const signedInAs = useCallback((signedIn: AccountUser, created: boolean): Outcome<{ user: AccountUser; created: boolean }> => {
    setUser(signedIn);
    userRef.current = signedIn;
    setStatus("signedIn");
    void runSync(true);
    return { ok: true, user: signedIn, created };
  }, [runSync]);

  const verify = useCallback(async (email: string, code: string): Promise<Outcome<{ user: AccountUser; created: boolean }>> => {
    try {
      const result = await client.verify(serverUrl, email, code);
      if (!isOk(result) || !result.body.user) return failure(result);
      return signedInAs(result.body.user, Boolean(result.body.created));
    } catch {
      return networkFailure();
    }
  }, [client, serverUrl, signedInAs]);

  /** Was the "Entrar no Oghma" button in the e-mail confirmed? `pending` while waiting. */
  const pollLogin = useCallback(async (email: string, loginId: string): Promise<Outcome<{ user: AccountUser; created: boolean }>> => {
    try {
      const result = await client.poll(serverUrl, email, loginId);
      if (result.status === 202) return { ok: false, error: "pending" };
      if (!isOk(result) || !result.body.user) return failure(result);
      return signedInAs(result.body.user, Boolean(result.body.created));
    } catch {
      return { ok: false, error: "pending" };
    }
  }, [client, serverUrl, signedInAs]);

  const checkNickname = useCallback(async (nickname: string) => {
    try {
      const result = await client.api<{ available: boolean; reason: string | null; suggestions: string[] }>(
        "GET",
        `/v1/nicknames/${encodeURIComponent(nickname.trim())}/available`
      );
      return isOk(result) ? result.body : null;
    } catch {
      return null;
    }
  }, [client]);

  const updateProfile = useCallback(async (patch: { nickname?: string; avatarId?: string; avatarColor?: string }): Promise<Outcome<{ user: AccountUser }>> => {
    try {
      const result = await client.api<AccountUser>("PATCH", "/v1/me", patch);
      if (result.status === 401) signOutLocally();
      if (!isOk(result)) return failure(result);
      setUser(result.body);
      return { ok: true, user: result.body };
    } catch {
      return networkFailure();
    }
  }, [client, signOutLocally]);

  const listSessions = useCallback(async (): Promise<AccountSessionInfo[] | null> => {
    try {
      const result = await client.api<{ sessions: AccountSessionInfo[] }>("GET", "/v1/me/sessions");
      return isOk(result) ? result.body.sessions : null;
    } catch {
      return null;
    }
  }, [client]);

  const endSession = useCallback(async (id: number) => {
    try {
      return isOk(await client.api("DELETE", `/v1/me/sessions/${id}`));
    } catch {
      return false;
    }
  }, [client]);

  const logout = useCallback(async () => {
    try {
      await client.logout();
    } finally {
      signOutLocally();
    }
  }, [client, signOutLocally]);

  const deleteAccount = useCallback(async (): Promise<Outcome> => {
    try {
      const result = await client.api("DELETE", "/v1/me");
      if (!isOk(result)) return failure(result);
      if (userRef.current) writeStorage(CURSOR_PREFIX + userRef.current.publicId, null);
      await client.forget();
      signOutLocally();
      return { ok: true };
    } catch {
      return networkFailure();
    }
  }, [client, signOutLocally]);

  const setServerUrl = useCallback((url: string) => {
    const value = url.trim() || DEFAULT_ACCOUNT_SERVER;
    setServerUrlState(value);
    writeStorage(SERVER_KEY, value === DEFAULT_ACCOUNT_SERVER ? null : value);
  }, []);

  return useMemo(() => ({
    available: client.available,
    status,
    user,
    signedIn: status === "signedIn",
    /** Signed in but the profile (nickname/avatar) is still empty: show the profile step. */
    needsProfile: Boolean(user?.needsProfile),
    serverUrl,
    setServerUrl,
    sync,
    syncNow: () => runSync(),
    requestCode,
    verify,
    pollLogin,
    checkNickname,
    updateProfile,
    listSessions,
    endSession,
    logout,
    deleteAccount
  }), [checkNickname, client.available, deleteAccount, endSession, listSessions, logout, pollLogin, requestCode, runSync, serverUrl, setServerUrl, status, sync, updateProfile, user, verify]);
}

export type OghmaAccountController = ReturnType<typeof useOghmaAccount>;
