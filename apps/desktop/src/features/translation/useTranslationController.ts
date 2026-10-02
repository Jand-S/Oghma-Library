import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppView, NavParams } from "../../app/NavigationContext";
import type { LibraryItem } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import {
  getTranslationClient,
  translationApi,
  type ChapterView,
  type GlossaryEntry,
  type GlossaryKind,
  type GlossarySuggestion,
  type LogEvent,
  type PilotRun,
  type ProjectDetail,
  type ProjectSettingsPatch,
  type ProjectSummary,
  type TranslationClient,
  type UsageSnapshot,
  type VerifyReport
} from "../../services/translationClient";
import { modelLabel, translationStrings as t } from "../../strings/translation";
import type { ToastOptions } from "../../ui";
import { readTranslationPreferences } from "../settings/preferences";

export type TranslationAccountState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "error"; message: string }
  | { status: "logged_out" }
  | { status: "logged_in"; email?: string; planType?: string };

export type TranslationTab = "progress" | "pilot" | "glossary" | "review";

type TranslationControllerArgs = {
  /** Transport; defaults to the Tauri client (tests inject a fake). */
  client?: TranslationClient;
  library: LibraryItem[];
  toast: (options: ToastOptions) => void;
  /** Rescans the library (after a PT-BR book is exported). */
  refreshLibrary: () => void;
  navigate: (view: AppView, params?: NavParams) => void;
};

const LOG_LIMIT = 300;
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const SUMMARY_KEYS = ["id", "title", "coverUrl", "sourceNovelId", "status", "chaptersTotal", "chaptersDone", "chunksTotal", "chunksDone", "percent", "outputDir"] as const;

/** Only the summary fields (a list entry must not override the detail's other fields). */
function toSummary(detail: ProjectSummary): ProjectSummary {
  const summary = {} as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) if (detail[key] !== undefined) summary[key] = detail[key];
  return summary as ProjectSummary;
}

function upsertSummary(list: ProjectSummary[], summary: ProjectSummary) {
  const index = list.findIndex((item) => item.id === summary.id);
  if (index < 0) return [summary, ...list];
  const next = [...list];
  next[index] = { ...next[index], ...summary };
  return next;
}

/** Library id of an exported book (see `buildLibraryItems`). */
export const libraryBookId = (outputDir: string) => `local-${outputDir}`;

/** Only books with an EPUB on disk can be translated; PT-BR outputs are not offered again. */
export function isTranslatable(item: LibraryItem) {
  const formats = item.formats?.length ? item.formats : [item.format];
  return Boolean(item.outputDir) && formats.includes("EPUB") && !item.novelId?.endsWith(":pt-BR");
}

/**
 * Translation workspace state that outlives the page (it also listens to engine events
 * app-wide, so the library refreshes when a PT-BR book is exported on another screen).
 */
export function useTranslationController({ client: injected, library, toast, refreshLibrary, navigate }: TranslationControllerArgs) {
  const [client] = useState(() => injected ?? getTranslationClient());
  const api = useMemo(() => translationApi(client), [client]);

  const [account, setAccount] = useState<TranslationAccountState>(() => (client.available ? { status: "loading" } : { status: "unavailable" }));
  const [connecting, setConnecting] = useState(false);
  const connectingRef = useRef(false);
  const [usage, setUsage] = useState<UsageSnapshot | null>(null);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState<TranslationTab>("progress");
  const [details, setDetails] = useState<Record<string, ProjectDetail>>({});
  const [logs, setLogs] = useState<Record<string, LogEvent[]>>({});
  const [pilots, setPilots] = useState<Record<string, PilotRun | null>>({});
  const [glossaries, setGlossaries] = useState<Record<string, GlossaryEntry[]>>({});
  // projectId -> term -> pending AI suggestion
  const [suggestions, setSuggestions] = useState<Record<string, Record<string, GlossarySuggestion>>>({});
  const [reports, setReports] = useState<Record<string, VerifyReport>>({});
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  // Latest callbacks for the long-lived event listeners.
  const latest = useRef({ toast, refreshLibrary, navigate });
  latest.current = { toast, refreshLibrary, navigate };
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  const fail = useCallback((message: string, error: unknown) => {
    const detail = getErrorMessage(error, "");
    latest.current.toast({ message: detail && detail !== "unavailable" ? `${message} (${detail.slice(0, 140)})` : message, tone: "danger" });
  }, []);

  const withBusy = useCallback(async <T,>(key: string, run: () => Promise<T>, failMessage: string): Promise<T | undefined> => {
    setBusy((current) => new Set(current).add(key));
    try {
      return await run();
    } catch (error) {
      fail(failMessage, error);
      return undefined;
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [fail]);

  const isBusy = useCallback((key: string) => busy.has(key), [busy]);

  const loadUsage = useCallback(() => {
    void api.usage().then(setUsage).catch(() => undefined);
  }, [api]);

  const refreshAccount = useCallback(async () => {
    if (!client.available) {
      setAccount({ status: "unavailable" });
      return;
    }
    setAccount({ status: "loading" });
    try {
      const info = await api.account();
      if (info.loggedIn) setAccount({ status: "logged_in", email: info.email, planType: info.planType });
      else setAccount({ status: "logged_out" });
      loadUsage();
      const list = await api.listProjects();
      setProjects(list);
      setSelectedId((current) => (current && list.some((item) => item.id === current) ? current : list[0]?.id ?? ""));
    } catch (error) {
      setAccount({ status: "error", message: getErrorMessage(error, t.accountError) });
    } finally {
      setProjectsLoaded(true);
    }
  }, [api, client.available, loadUsage]);

  useEffect(() => {
    void refreshAccount();
  }, [refreshAccount]);

  // Engine events.
  useEffect(() => {
    if (!client.available) return;
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      }).catch(() => undefined);
    };

    track(client.listen("translation://usage", (snapshot) => setUsage(snapshot)));
    track(client.listen("translation://project", (detail) => {
      setDetails((current) => ({ ...current, [detail.id]: detail }));
      setProjects((current) => upsertSummary(current, toSummary(detail)));
    }));
    track(client.listen("translation://log", ({ projectId, event }) => {
      setLogs((current) => ({ ...current, [projectId]: [...(current[projectId] ?? []), event].slice(-LOG_LIMIT) }));
    }));
    track(client.listen("translation://pilot", ({ projectId, run }) => {
      setPilots((current) => ({ ...current, [projectId]: run }));
    }));
    track(client.listen("translation://glossary", ({ projectId, status }) => {
      setDetails((current) => (current[projectId] ? { ...current, [projectId]: { ...current[projectId], glossaryStatus: status } } : current));
      if (status === "ready") {
        void api.glossary(projectId).then((entries) => setGlossaries((current) => ({ ...current, [projectId]: entries }))).catch(() => undefined);
      }
    }));
    track(client.listen("translation://account", (info) => {
      const wasConnecting = connectingRef.current;
      connectingRef.current = false;
      setConnecting(false);
      if (info.loggedIn) {
        setAccount({ status: "logged_in", email: info.email, planType: info.planType });
        if (wasConnecting) latest.current.toast({ message: t.connectedToast(info.email), tone: "success" });
        loadUsage();
      } else {
        setAccount({ status: "logged_out" });
      }
    }));
    track(client.listen("translation://exported", ({ projectId, outputDir, title }) => {
      latest.current.refreshLibrary();
      setProjects((current) => current.map((item) => (item.id === projectId ? { ...item, outputDir } : item)));
      setDetails((current) => (current[projectId] ? { ...current, [projectId]: { ...current[projectId], outputDir } } : current));
      latest.current.toast({
        message: t.exportedToast(title),
        tone: "success",
        action: { label: t.openInLibrary, onClick: () => latest.current.navigate("library", { book: libraryBookId(outputDir) }) }
      });
    }));

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [api, client, loadUsage]);

  // While ChatGPT refuses for limits, re-read the state shortly after the engine's next retry.
  useEffect(() => {
    const retryAt = usage?.limitReached?.nextRetryAt;
    if (retryAt == null) return;
    const delayMs = Math.min(2 ** 31 - 1, Math.max(5, retryAt - Date.now() / 1000 + 10) * 1000);
    const handle = window.setTimeout(loadUsage, delayMs);
    return () => window.clearTimeout(handle);
  }, [loadUsage, usage]);

  // Load the selected project's data.
  useEffect(() => {
    if (!selectedId || !client.available) return;
    let alive = true;
    const id = selectedId;
    void api.getProject(id).then((detail) => {
      if (!alive) return;
      setDetails((current) => ({ ...current, [id]: detail }));
      setProjects((current) => upsertSummary(current, toSummary(detail)));
    }).catch((error: unknown) => fail(t.genericError, error));
    void api.log(id, LOG_LIMIT).then((events) => alive && setLogs((current) => ({ ...current, [id]: events }))).catch(() => undefined);
    void api.pilot(id).then((run) => alive && setPilots((current) => ({ ...current, [id]: run }))).catch(() => undefined);
    void api.glossary(id).then((entries) => alive && setGlossaries((current) => ({ ...current, [id]: entries }))).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [api, client.available, fail, selectedId]);

  const selectProject = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  /* ---------- Account ---------- */

  /** Rust runs the PKCE flow and opens the browser; we wait for `translation://account`. */
  const connect = useCallback(async () => {
    connectingRef.current = true;
    setConnecting(true);
    try {
      await api.login();
      // If the command only returns after the flow, the account may already be connected.
      if (connectingRef.current) {
        const info = await api.account().catch(() => null);
        if (info?.loggedIn && connectingRef.current) {
          connectingRef.current = false;
          setConnecting(false);
          setAccount({ status: "logged_in", email: info.email, planType: info.planType });
          toast({ message: t.connectedToast(info.email), tone: "success" });
          loadUsage();
        }
      }
    } catch (error) {
      // A cancelled login rejects too; only report real failures.
      if (connectingRef.current) fail(t.connectFailed, error);
      connectingRef.current = false;
      setConnecting(false);
    }
  }, [api, fail, loadUsage, toast]);

  const cancelConnect = useCallback(() => {
    connectingRef.current = false;
    setConnecting(false);
    void api.loginCancel().catch(() => undefined);
  }, [api]);

  const logout = useCallback(async () => {
    const ok = await withBusy("logout", () => api.logout().then(() => true), t.logoutFailed);
    if (!ok) return;
    setAccount({ status: "logged_out" });
    toast({ message: t.loggedOut, tone: "info" });
  }, [api, toast, withBusy]);

  /** "Gerenciar uso": the ChatGPT usage settings page. */
  const openUsagePage = useCallback(() => {
    void client.openUrl(usage?.settingsUrl || CHATGPT_USAGE_URL);
  }, [client, usage?.settingsUrl]);

  /* ---------- Projects ---------- */

  const applyDetail = useCallback((detail: ProjectDetail | undefined) => {
    if (!detail) return;
    setDetails((current) => ({ ...current, [detail.id]: detail }));
    setProjects((current) => upsertSummary(current, toSummary(detail)));
  }, []);

  const createProject = useCallback(async (item: LibraryItem) => {
    if (!item.outputDir) return false;
    const outputDir = item.outputDir;
    const created = await withBusy("create", async () => {
      const summary = await api.createProject({ sourceDir: outputDir, sourceNovelId: item.novelId, title: item.title });
      setProjects((current) => upsertSummary(current, summary));
      const prefs = readTranslationPreferences();
      const detail = await api.updateSettings(summary.id, { model: prefs.model, effort: prefs.effort, workers: prefs.workers });
      applyDetail(detail);
      return summary;
    }, t.createFailed);
    if (!created) return false;
    setSelectedId(created.id);
    setTab("pilot");
    toast({ message: t.projectCreated(item.title), tone: "success" });
    return true;
  }, [api, applyDetail, toast, withBusy]);

  const deleteProject = useCallback(async (id: string) => {
    const title = projects.find((item) => item.id === id)?.title ?? "";
    const ok = await withBusy(`${id}:delete`, () => api.deleteProject(id).then(() => true), t.deleteFailed);
    if (!ok) return;
    const remaining = projects.filter((item) => item.id !== id);
    setProjects((current) => current.filter((item) => item.id !== id));
    if (selectedRef.current === id) setSelectedId(remaining[0]?.id ?? "");
    toast({ message: t.deleted(title), tone: "info" });
  }, [api, projects, toast, withBusy]);

  const updateSettings = useCallback(async (id: string, patch: ProjectSettingsPatch, failMessage: string = t.settingsFailed) => {
    const detail = await withBusy(`${id}:settings`, () => api.updateSettings(id, patch), failMessage);
    applyDetail(detail);
    return Boolean(detail);
  }, [api, applyDetail, withBusy]);

  const start = useCallback((id: string) => withBusy(`${id}:run`, () => api.start(id), t.startFailed), [api, withBusy]);
  const pause = useCallback((id: string) => withBusy(`${id}:run`, () => api.pause(id), t.pauseFailed), [api, withBusy]);
  const cancel = useCallback((id: string) => withBusy(`${id}:run`, () => api.cancel(id), t.cancelFailed), [api, withBusy]);

  const exportBook = useCallback(async (id: string) => {
    const result = await withBusy(`${id}:export`, () => api.exportBook(id), t.exportFailed);
    if (result) {
      setProjects((current) => current.map((item) => (item.id === id ? { ...item, outputDir: result.outputDir } : item)));
      setDetails((current) => (current[id] ? { ...current, [id]: { ...current[id], outputDir: result.outputDir } } : current));
    }
  }, [api, withBusy]);

  const openInLibrary = useCallback((outputDir: string) => {
    navigate("library", { book: libraryBookId(outputDir) });
  }, [navigate]);

  /* ---------- Pilot ---------- */

  const runPilot = useCallback(async (id: string) => {
    setPilots((current) => ({
      ...current,
      [id]: { createdAt: Date.now() / 1000, sourceHtml: current[id]?.sourceHtml ?? "", words: current[id]?.words ?? 0, samples: [], status: "running" }
    }));
    const ok = await withBusy(`${id}:pilot`, () => api.runPilot(id).then(() => true), t.pilotRunFailed);
    if (!ok) void api.pilot(id).then((run) => setPilots((current) => ({ ...current, [id]: run }))).catch(() => undefined);
  }, [api, withBusy]);

  const chooseModel = useCallback(async (id: string, model: string) => {
    const detail = await withBusy(`${id}:model`, () => api.chooseModel(id, model), t.chooseFailed);
    if (!detail) return;
    applyDetail(detail);
    toast({ message: t.modelChosen(modelLabel(model)), tone: "success" });
  }, [api, applyDetail, toast, withBusy]);

  /* ---------- Glossary ---------- */

  const upsertTerm = useCallback(async (id: string, entry: { term: string; kind: GlossaryKind; target?: string }) => {
    const entries = await withBusy(`${id}:glossary`, () => api.glossaryUpsert(id, entry), t.termSaveFailed);
    if (entries) setGlossaries((current) => ({ ...current, [id]: entries }));
    return Boolean(entries);
  }, [api, withBusy]);

  const deleteTerm = useCallback(async (id: string, term: string) => {
    const entries = await withBusy(`${id}:glossary`, () => api.glossaryDelete(id, term), t.termRemoveFailed);
    if (entries) setGlossaries((current) => ({ ...current, [id]: entries }));
  }, [api, withBusy]);

  const regenerateGlossary = useCallback(async (id: string) => {
    const ok = await withBusy(`${id}:glossary`, () => api.glossaryRegenerate(id).then(() => true), t.regenerateFailed);
    if (!ok) return;
    setDetails((current) => (current[id] ? { ...current, [id]: { ...current[id], glossaryStatus: "running" } } : current));
    toast({ message: t.regenerateStarted, tone: "info" });
  }, [api, toast, withBusy]);

  /** Asks the model for suggestions (one call for all `terms`); results stay pending until accepted or dismissed. */
  const suggestTerms = useCallback(async (id: string, terms: string[]) => {
    if (terms.length === 0) return;
    const key = terms.length === 1 ? `${id}:suggest:${terms[0]}` : `${id}:suggest-all`;
    const found = await withBusy(key, () => api.glossarySuggest(id, terms), t.suggestFailed);
    if (!found) return;
    setSuggestions((current) => {
      const next = { ...(current[id] ?? {}) };
      for (const suggestion of found) next[suggestion.term] = suggestion;
      return { ...current, [id]: next };
    });
    if (found.length === 0) toast({ message: t.suggestNone, tone: "info" });
  }, [api, toast, withBusy]);

  const dismissSuggestion = useCallback((id: string, term: string) => {
    setSuggestions((current) => {
      const next = { ...(current[id] ?? {}) };
      delete next[term];
      return { ...current, [id]: next };
    });
  }, []);

  const acceptSuggestion = useCallback(async (id: string, suggestion: GlossarySuggestion) => {
    const ok = await upsertTerm(id, {
      term: suggestion.term,
      kind: suggestion.kind,
      target: suggestion.kind === "translate" ? suggestion.target ?? undefined : undefined
    });
    if (ok) {
      dismissSuggestion(id, suggestion.term);
      toast({ message: t.termSaved(suggestion.term), tone: "success" });
    }
  }, [dismissSuggestion, toast, upsertTerm]);

  /* ---------- Review ---------- */

  const verify = useCallback(async (id: string) => {
    const report = await withBusy(`${id}:verify`, () => api.verify(id), t.verifyFailed);
    if (report) setReports((current) => ({ ...current, [id]: report }));
  }, [api, withBusy]);

  const loadChapter = useCallback((id: string, index: number): Promise<ChapterView> => api.chapter(id, index), [api]);

  const retranslate = useCallback(async (id: string, index: number, title: string) => {
    const ok = await withBusy(`${id}:retranslate`, () => api.retranslate(id, index).then(() => true), t.retranslateFailed);
    if (ok) toast({ message: t.retranslateStarted(title), tone: "info" });
    return Boolean(ok);
  }, [api, toast, withBusy]);

  const selectedSummary = projects.find((item) => item.id === selectedId) ?? null;
  const selected: ProjectDetail | null = selectedId && details[selectedId]
    ? { ...details[selectedId], ...(selectedSummary ? toSummary(selectedSummary) : {}) }
    : null;
  const translatable = useMemo(() => library.filter(isTranslatable), [library]);
  const loggedIn = account.status === "logged_in";

  return {
    available: client.available,
    account,
    loggedIn,
    connecting,
    refreshAccount,
    connect,
    cancelConnect,
    logout,
    openUsagePage,
    usage,
    // projects
    projects,
    projectsLoaded,
    library,
    translatable,
    selectedId,
    selectedSummary,
    selected,
    selectProject,
    tab,
    setTab,
    createProject,
    deleteProject,
    updateSettings,
    start,
    pause,
    cancel,
    exportBook,
    openInLibrary,
    // per-project data
    logs: logs[selectedId] ?? [],
    pilot: pilots[selectedId] ?? null,
    runPilot,
    chooseModel,
    glossary: glossaries[selectedId],
    upsertTerm,
    deleteTerm,
    regenerateGlossary,
    suggestions: suggestions[selectedId] ?? {},
    suggestTerms,
    acceptSuggestion,
    dismissSuggestion,
    report: reports[selectedId] ?? null,
    verify,
    loadChapter,
    retranslate,
    isBusy
  };
}

export type TranslationController = ReturnType<typeof useTranslationController>;
