import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppConfig, LibraryItem, TranslationJob } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { translationStrings } from "../../strings/translation";
import {
  AUTOMATIC_MODEL,
  defaultSettings,
  MAX_WORKERS,
  parseDecimal,
  patchSessionFromJob,
  PILOT_CHAPTERS,
  projectKey,
  type FormatFilter,
  type GlossaryTerm,
  type TranslationBatchDraft,
  type TranslationSessionItem,
  type TranslationSettings
} from "./translationModel";

type TranslationControllerArgs = {
  backend: BackendClient;
  library: LibraryItem[];
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onOpenItemFolder: (item: LibraryItem) => void;
  notify: (message: string) => void;
};

const JOB_POLL_MS = 3000;

function withFlag(set: Set<string>, id: string, on: boolean) {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/**
 * State and actions of the Translation workspace that must outlive the page:
 * selected project, next-batch settings, prepared batches (and their jobs) and
 * the manual glossary. Estimates and translation memory are page-scoped and
 * live in `useTranslationPlanner` / `useTranslationMemory`.
 */
export function useTranslationController({ backend, library, config, onConfigChange, onOpenItemFolder, notify }: TranslationControllerArgs) {
  const [selectedId, setSelectedId] = useState("");
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<FormatFilter>("all");
  const [settings, setSettings] = useState<TranslationSettings>(() => defaultSettings(config.translationEngine));
  const [sessionItems, setSessionItems] = useState<TranslationSessionItem[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [glossaryByProject, setGlossaryByProject] = useState<Record<string, GlossaryTerm[]>>({});

  const selectedItem = library.find((item) => item.id === selectedId) ?? null;

  const resetScopeFor = useCallback((item: LibraryItem | undefined) => {
    const chapters = Math.max(1, item?.chapters || 1);
    setSettings((current) => ({ ...current, scope: "pilot", rangeStart: 1, rangeEnd: Math.min(PILOT_CHAPTERS, chapters) }));
  }, []);

  const selectProject = useCallback((id: string) => {
    setSelectedId(id);
    resetScopeFor(library.find((item) => item.id === id));
  }, [library, resetScopeFor]);

  // Keep a valid selection while the library loads or changes.
  useEffect(() => {
    if (library.length === 0) {
      if (selectedId) setSelectedId("");
      return;
    }
    if (!library.some((item) => item.id === selectedId)) selectProject(library[0].id);
  }, [library, selectedId, selectProject]);

  const patchSettings = useCallback((patch: Partial<TranslationSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      if (next.workerCount !== current.workerCount) next.workerCount = Math.max(1, Math.min(MAX_WORKERS, Math.round(next.workerCount) || 1));
      // The editorial grader is a paid call: it can only stay on while paid providers are allowed.
      if (!next.allowPaidProviders) next.allowEditorialGrader = false;
      return next;
    });
  }, []);

  const setModel = useCallback((model: string) => patchSettings({ model }), [patchSettings]);

  // Poll job stats while any batch has a job.
  const hasJobs = sessionItems.some((item) => item.jobId);
  useEffect(() => {
    if (!hasJobs) return;
    let cancelled = false;
    const refreshJobs = () => {
      void backend.listTranslationJobs()
        .then((jobs) => {
          if (cancelled) return;
          const jobById = new Map(jobs.map((job) => [job.id, job]));
          setSessionItems((items) => items.map((item) => {
            const job = item.jobId ? jobById.get(item.jobId) : null;
            return job ? patchSessionFromJob(item, job) : item;
          }));
        })
        .catch(() => undefined);
    };
    refreshJobs();
    const handle = window.setInterval(refreshJobs, JOB_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [backend, hasJobs]);

  const applyJob = useCallback((itemId: string, job: TranslationJob) => {
    setSessionItems((items) => items.map((item) => (item.id === itemId ? patchSessionFromJob(item, job) : item)));
  }, []);

  const addBatch = useCallback((draft: TranslationBatchDraft) => {
    const entry: TranslationSessionItem = { ...draft, id: `${draft.projectId}-${Date.now()}`, status: "ready" };
    setSessionItems((items) => [entry, ...items]);
    notify(translationStrings.batchAdded(draft.title));
  }, [notify]);

  const removeBatch = useCallback((itemId: string) => {
    setSessionItems((items) => items.filter((item) => item.id !== itemId));
  }, []);

  const runJob = useCallback(async (item: TranslationSessionItem, quiet = false) => {
    if (!item.jobId) return;
    setBusyIds((ids) => withFlag(ids, item.id, true));
    try {
      const job = await backend.runTranslationJob(item.jobId, settings.allowPaidProviders, settings.allowEditorialGrader);
      applyJob(item.id, job);
      if (!quiet) {
        notify(settings.allowPaidProviders ? translationStrings.runPaid(settings.allowEditorialGrader) : translationStrings.runSafe);
      }
    } catch (error) {
      notify(getErrorMessage(error, translationStrings.runFailed));
    } finally {
      setBusyIds((ids) => withFlag(ids, item.id, false));
    }
  }, [applyJob, backend, notify, settings.allowEditorialGrader, settings.allowPaidProviders]);

  /** Creates jobs for the project's batches that have none yet, then runs them. */
  const startTranslation = useCallback(async (projectId: string) => {
    const pending = sessionItems.filter((item) => item.projectId === projectId && !item.jobId);
    if (pending.length === 0) {
      notify(translationStrings.nothingToStart);
      return;
    }
    const pendingIds = new Set(pending.map((item) => item.id));
    setSessionItems((items) => items.map((item) => (pendingIds.has(item.id) ? { ...item, status: "waiting" } : item)));
    const usdBrl = parseDecimal(settings.usdBrl);
    const budgetBrl = parseDecimal(settings.maxBudgetBrl);
    const maxCostUsd = budgetBrl > 0 && usdBrl > 0 ? budgetBrl / usdBrl : null;
    let created: Array<{ item: TranslationSessionItem; job: TranslationJob }>;
    try {
      created = await Promise.all(pending.map(async (item) => ({
        item,
        job: await backend.createTranslationJob({
          novelId: item.novelId,
          chapterFrom: item.chapterFrom,
          chapterTo: item.chapterTo,
          targetLanguage: config.targetLanguage,
          mode: item.mode,
          strategy: item.model === AUTOMATIC_MODEL ? "automatic" : "manual",
          selectedModel: item.model,
          provider: item.provider,
          workerCount: item.workerCount,
          reuseExisting: true,
          maxCostUsd,
          usdBrlRate: usdBrl,
          sourceChars: item.sourceChars
        })
      })));
    } catch (error) {
      setSessionItems((items) => items.map((item) => (pendingIds.has(item.id) ? { ...item, status: "ready" } : item)));
      notify(getErrorMessage(error, translationStrings.createJobsFailed));
      return;
    }
    for (const { item, job } of created) applyJob(item.id, job);
    await Promise.all(created.map(({ item, job }) => runJob({ ...item, jobId: job.id }, true)));
    notify(settings.allowPaidProviders
      ? `${translationStrings.jobsStarted(created.length)} ${translationStrings.runPaid(settings.allowEditorialGrader)}`
      : `${translationStrings.jobsStarted(created.length)} ${translationStrings.jobsStartedSafe}`);
  }, [applyJob, backend, config.targetLanguage, notify, runJob, sessionItems, settings.allowEditorialGrader, settings.allowPaidProviders, settings.maxBudgetBrl, settings.usdBrl]);

  const jobAction = useCallback(async (
    item: TranslationSessionItem,
    call: (jobId: string) => Promise<TranslationJob>,
    fallback: string
  ) => {
    if (!item.jobId) return;
    setBusyIds((ids) => withFlag(ids, item.id, true));
    try {
      applyJob(item.id, await call(item.jobId));
    } catch (error) {
      notify(getErrorMessage(error, fallback));
    } finally {
      setBusyIds((ids) => withFlag(ids, item.id, false));
    }
  }, [applyJob, notify]);

  const pauseJob = useCallback((item: TranslationSessionItem) => jobAction(item, (id) => backend.pauseTranslationJob(id), translationStrings.pauseFailed), [backend, jobAction]);
  const resumeJob = useCallback((item: TranslationSessionItem) => jobAction(item, (id) => backend.resumeTranslationJob(id), translationStrings.resumeFailed), [backend, jobAction]);
  const cancelJob = useCallback((item: TranslationSessionItem) => jobAction(item, (id) => backend.cancelTranslationJob(id), translationStrings.cancelFailed), [backend, jobAction]);

  const addGlossaryTerm = useCallback((projectId: string, source: string, target: string) => {
    const term: GlossaryTerm = { id: `${source}-${Date.now()}`, source, target, note: translationStrings.manualNote };
    setGlossaryByProject((current) => ({ ...current, [projectId]: [term, ...(current[projectId] ?? [])] }));
  }, []);

  const removeGlossaryTerm = useCallback((projectId: string, termId: string) => {
    setGlossaryByProject((current) => ({ ...current, [projectId]: (current[projectId] ?? []).filter((term) => term.id !== termId) }));
  }, []);

  const selectedKey = selectedItem ? projectKey(selectedItem) : "";
  const projectItems = useMemo(
    () => sessionItems.filter((item) => item.projectId === selectedId),
    [selectedId, sessionItems]
  );

  return {
    backend,
    library,
    config,
    onConfigChange,
    notify,
    openFolder: onOpenItemFolder,
    // project list
    query,
    setQuery,
    format,
    setFormat,
    selectedId,
    selectedItem,
    selectedKey,
    selectProject,
    // next-batch settings
    settings,
    patchSettings,
    setModel,
    // batches and jobs
    sessionItems,
    projectItems,
    busyIds,
    addBatch,
    removeBatch,
    startTranslation,
    runJob,
    pauseJob,
    resumeJob,
    cancelJob,
    // manual glossary
    glossaryTerms: glossaryByProject[selectedKey] ?? [],
    addGlossaryTerm,
    removeGlossaryTerm
  };
}

export type TranslationController = ReturnType<typeof useTranslationController>;
