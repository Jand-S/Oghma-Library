import { isTauriRuntime } from "../core/windowControls";

/*
 * TS side of the translation contract (`docs/TRANSLATION_CONTRACT.md`, as amended by the 2026-10-02
 * "Sign in with ChatGPT" change and the owner's final decision: no usage %): types, commands and events of the Rust engine in
 * `src-tauri/src/translation/`. The UI never talks to OpenAI directly.
 */

// ---------- Types (mirrors of the Rust serde camelCase structs) ----------

export type TranslationModelId = "gpt-6-luna" | "gpt-6-sol";
export type TranslationEffort = "none" | "low";

export type TranslationAccount = {
  loggedIn: boolean;
  email?: string;
  planType?: string;
};

/** Set while ChatGPT refuses requests for usage limits; the engine retries every ~15 min. */
export type LimitState = {
  /** Unix seconds when the limit was hit. */
  at: number;
  window: "five_hour" | "weekly" | "unknown";
  /** Unix seconds of the next automatic retry. */
  nextRetryAt: number;
};

/** The app's own counters (`usage_log`). There is no API for the plan's usage %. */
export type LocalUsage = { words5h: number; credits5h: number; words7d: number; credits7d: number };

export type UsageSnapshot = {
  local: LocalUsage;
  limitReached: LimitState | null;
  settingsUrl: string;
};

export type ProjectStatus = "preparing" | "ready" | "running" | "paused" | "waiting_limit" | "done" | "exported" | "error";

export type TranslationScope = { kind: "all" } | { kind: "range"; from: number; to: number };

export type ProjectSummary = {
  id: string;
  title: string;
  coverUrl?: string;
  sourceNovelId?: string;
  /** Author of the original book (written into the PT-BR book). */
  author?: string;
  status: ProjectStatus;
  chaptersTotal: number;
  chaptersDone: number;
  chunksTotal: number;
  chunksDone: number;
  percent: number;
  outputDir?: string;
};

export type GlossaryStatus = "idle" | "running" | "ready" | "error";

export type ProjectDetail = ProjectSummary & {
  model: string;
  effort: TranslationEffort;
  workers: number;
  scope: TranslationScope;
  wordsTotal: number;
  wordsDone: number;
  needsReview: number;
  errors: number;
  pending: number;
  chaptersInProgress: string[];
  chunksPerMinute: number | null;
  etaSeconds: number | null;
  /** Unix seconds of the next automatic retry (while `waiting_limit`). */
  resumeAt: number | null;
  glossaryStatus: GlossaryStatus;
  /** Unix seconds of the last preview (partial book) export. */
  lastPreviewAt?: number | null;
};

export type GlossaryKind = "keep" | "translate";

export type GlossaryEntry = {
  term: string;
  kind: GlossaryKind;
  target: string | null;
  count: number;
  source: "auto" | "manual";
  missed: number;
};

export type GlossarySuggestion = {
  term: string;
  kind: GlossaryKind;
  target: string | null;
  reason: string;
};

export type PilotSample = {
  model: string;
  label: string;
  seconds: number;
  inputTokens: number;
  outputTokens: number;
  /** Estimated plan credits for the whole book ("créditos estimados"). */
  projectedBookCredits: number | null;
  valid: boolean;
  html: string;
};

export type PilotRun = {
  createdAt: number;
  sourceHtml: string;
  words: number;
  samples: PilotSample[];
  status: "running" | "done" | "error";
  error?: string;
};

export type VerifyReport = { ok: boolean; chapters: { index: number; title: string; issues: string[] }[] };

export type LogLevel = "info" | "warn" | "error";
/** `at` is a unix timestamp in seconds. */
export type LogEvent = { at: number; level: LogLevel; message: string };

export type ParagraphPair = { source: string | null; translated: string | null };

export type ChunkView = {
  index: number;
  status: string;
  reviewed: boolean;
  /** Issue codes of this chunk: `"code"` or `"code: detail"`. */
  issues: string[];
  /** English words left in the translation, to highlight. */
  englishWords: string[];
  pairs: ParagraphPair[];
};

export type ChapterView = {
  index: number;
  title: string;
  sourceHtml: string;
  translatedHtml?: string | null;
  status: string;
  issues: string[];
  chunks: ChunkView[];
};

export type ExportResult = { outputDir: string; title: string };

export type ProjectSettingsPatch = {
  model?: string;
  effort?: TranslationEffort;
  workers?: number;
  scope?: TranslationScope;
};

// ---------- Events ----------

export type TranslationEvents = {
  "translation://usage": UsageSnapshot;
  "translation://project": ProjectDetail;
  "translation://log": { projectId: string; event: LogEvent };
  "translation://pilot": { projectId: string; run: PilotRun };
  "translation://glossary": { projectId: string; status: GlossaryStatus };
  "translation://account": { loggedIn: boolean; email?: string; planType?: string };
  "translation://exported": { projectId: string; outputDir: string; title: string; preview?: boolean };
};

export type TranslationEventName = keyof TranslationEvents;

// ---------- Transport ----------

/**
 * Raw transport. The default one wraps Tauri's `invoke`/`listen`; tests pass a fake with
 * scripted command handlers and an event emitter.
 */
export type TranslationClient = {
  /** False outside the desktop app (browser preview, tests without a fake). */
  available: boolean;
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  listen<E extends TranslationEventName>(event: E, handler: (payload: TranslationEvents[E]) => void): Promise<() => void>;
  /** Opens an http(s) URL in the default browser ("Gerenciar uso" → ChatGPT settings). */
  openUrl(url: string): Promise<void>;
};

async function openWithOpener(url: string) {
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

function createTauriTranslationClient(): TranslationClient {
  return {
    available: isTauriRuntime(),
    async invoke<T>(command: string, args?: Record<string, unknown>) {
      if (!isTauriRuntime()) throw new Error("unavailable");
      const { invoke } = await import("@tauri-apps/api/core");
      return invoke<T>(command, args);
    },
    async listen(event, handler) {
      if (!isTauriRuntime()) return () => undefined;
      const { listen } = await import("@tauri-apps/api/event");
      return listen(event, (message) => handler(message.payload as never));
    },
    openUrl: openWithOpener
  };
}

let defaultClient: TranslationClient | null = null;

/** App-wide client over Tauri IPC ("unavailable" outside the desktop app). */
export function getTranslationClient(): TranslationClient {
  defaultClient ??= createTauriTranslationClient();
  return defaultClient;
}

// ---------- Typed commands ----------

/** Typed wrappers over the `translation_*` commands of the contract. */
export function translationApi(client: TranslationClient) {
  const call = <T>(command: string, args?: Record<string, unknown>) => client.invoke<T>(command, args);
  return {
    account: () => call<TranslationAccount>("translation_account"),
    /** Runs the whole PKCE flow in Rust (it opens the browser); completion arrives as `translation://account`. */
    login: () => call<void>("translation_login"),
    loginCancel: () => call<void>("translation_login_cancel"),
    logout: () => call<void>("translation_logout"),
    usage: () => call<UsageSnapshot>("translation_usage"),
    listProjects: () => call<ProjectSummary[]>("translation_list_projects"),
    createProject: (args: { sourceDir: string; sourceNovelId?: string; title: string; coverPath?: string; author?: string }) =>
      call<ProjectSummary>("translation_create_project", args),
    setAuthor: (projectId: string, author: string) => call<ProjectSummary>("translation_set_author", { projectId, author }),
    deleteProject: (projectId: string) => call<void>("translation_delete_project", { projectId }),
    getProject: (projectId: string) => call<ProjectDetail>("translation_get_project", { projectId }),
    updateSettings: (projectId: string, patch: ProjectSettingsPatch) =>
      call<ProjectDetail>("translation_update_settings", { projectId, ...patch }),
    start: (projectId: string) => call<void>("translation_start", { projectId }),
    pause: (projectId: string) => call<void>("translation_pause", { projectId }),
    cancel: (projectId: string) => call<void>("translation_cancel", { projectId }),
    glossary: (projectId: string) => call<GlossaryEntry[]>("translation_glossary", { projectId }),
    glossaryUpsert: (projectId: string, entry: { term: string; kind: GlossaryKind; target?: string }) =>
      call<GlossaryEntry[]>("translation_glossary_upsert", { projectId, entry }),
    glossaryDelete: (projectId: string, term: string) => call<GlossaryEntry[]>("translation_glossary_delete", { projectId, term }),
    glossaryRegenerate: (projectId: string) => call<void>("translation_glossary_regenerate", { projectId }),
    glossarySuggest: (projectId: string, terms: string[]) =>
      call<GlossarySuggestion[]>("translation_glossary_suggest", { projectId, terms }),
    runPilot: (projectId: string) => call<void>("translation_run_pilot", { projectId }),
    pilot: (projectId: string) => call<PilotRun | null>("translation_pilot", { projectId }),
    chooseModel: (projectId: string, model: string) => call<ProjectDetail>("translation_choose_model", { projectId, model }),
    chapter: (projectId: string, chapterIndex: number) => call<ChapterView>("translation_chapter", { projectId, chapterIndex }),
    retranslate: (projectId: string, chapterIndex: number) => call<void>("translation_retranslate", { projectId, chapterIndex }),
    retranslateChunk: (projectId: string, chapterIndex: number, chunkIndex: number) =>
      call<void>("translation_retranslate_chunk", { projectId, chapterIndex, chunkIndex }),
    markReviewed: (projectId: string, chapterIndex: number, chunkIndex: number) =>
      call<ChapterView>("translation_mark_reviewed", { projectId, chapterIndex, chunkIndex }),
    verify: (projectId: string) => call<VerifyReport>("translation_verify", { projectId }),
    exportBook: (projectId: string, partial = false) => call<ExportResult>("translation_export", { projectId, partial }),
    log: (projectId: string, limit?: number) => call<LogEvent[]>("translation_log", { projectId, limit })
  };
}

export type TranslationApi = ReturnType<typeof translationApi>;
