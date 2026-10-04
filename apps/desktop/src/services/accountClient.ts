import { loadInvoke } from "./localFiles";

/** Where the Oghma account lives unless the reader points the app elsewhere (Ajustes > Conta). */
export const DEFAULT_ACCOUNT_SERVER = "https://conta.oghma.dev";

export type AccountUser = {
  publicId: string;
  email: string;
  nickname: string | null;
  avatarId: string | null;
  avatarColor: string | null;
  createdAt: string;
  /** A new account: the app asks for a nickname and an avatar. */
  needsProfile: boolean;
};

export type AccountSessionInfo = {
  id: number;
  deviceName: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
};

/** HTTP status and JSON body. Errors from the API come as `{ error: "<code>", ... }`. */
export type ApiResult<T = unknown> = { status: number; body: T };

export type ApiError = { error: string; retryAfter?: number; attemptsLeft?: number; availableAt?: string; suggestions?: string[] };

/**
 * The account API, through Rust: the session token stays there (a 0600 file) and never
 * reaches the web view. Outside the desktop app `available` is false.
 */
export type AccountClient = {
  available: boolean;
  status(): Promise<{ signedIn: boolean; baseUrl?: string | null }>;
  requestCode(baseUrl: string, email: string): Promise<ApiResult<Partial<ApiError> & { email?: string; resendIn?: number; loginId?: string }>>;
  /** The e-mail button was confirmed? 202 = still waiting, 200 = signed in (session kept in Rust). */
  poll(baseUrl: string, email: string, loginId: string): Promise<ApiResult<Partial<ApiError> & { status?: string; user?: AccountUser; created?: boolean }>>;
  verify(baseUrl: string, email: string, code: string): Promise<ApiResult<Partial<ApiError> & { user?: AccountUser; created?: boolean }>>;
  api<T = unknown>(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<ApiResult<T>>;
  logout(): Promise<void>;
  /** Forgets the session on this computer only (after the account was deleted). */
  forget(): Promise<void>;
};

export function isOk(result: ApiResult) {
  return result.status >= 200 && result.status < 300;
}

export function errorCode(result: ApiResult): string {
  const body = result.body as ApiError | null;
  return body?.error ?? (result.status >= 500 ? "server_error" : "unknown");
}

export function tauriAccountClient(): AccountClient {
  const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
    const invoke = await loadInvoke();
    if (!invoke) throw new Error("A conta Oghma só funciona no app desktop.");
    return invoke<T>(command, args);
  };
  return {
    available: typeof window !== "undefined" && "__TAURI_INTERNALS__" in window,
    status: () => call("oghma_account_status"),
    requestCode: (baseUrl, email) => call("oghma_account_request_code", { baseUrl, email }),
    verify: (baseUrl, email, code) => call("oghma_account_verify", { baseUrl, email, code }),
    poll: (baseUrl, email, loginId) => call("oghma_account_poll", { baseUrl, email, loginId }),
    api: (method, path, body) => call("oghma_account_api", { method, path, body: body ?? null }),
    logout: () => call("oghma_account_logout"),
    forget: () => call("oghma_account_forget")
  };
}
