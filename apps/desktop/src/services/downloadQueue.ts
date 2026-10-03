// Download queue store: one active job plus a short, reorderable queue.
// Framework-free (subscribe/getSnapshot for useSyncExternalStore). The runner loop
// lives here, not in React effects, so exactly one job runs at a time.
import type {
  AppConfig,
  DownloadFormat,
  DownloadJob,
  DownloadJobRequest,
  DownloadQueueSnapshot,
  EnqueueResult,
  JobKind,
  JobProgress,
  JobStatus,
  QueueItem
} from "../core/types";
import { createJobRunner, type JobResult, type RunJob } from "./jobRunner";

export type { JobResult, RunJob } from "./jobRunner";

export const QUEUE_STORAGE_KEY = "oghma.queue.v1";
export const MAX_QUEUED = 10;
export const MAX_COMPLETED = 50;

export type EnqueueInput = {
  novelId: string;
  title: string;
  coverUrl?: string;
  kind?: JobKind;
  request: DownloadJobRequest;
};

export type MoveDirection = "up" | "down" | "top" | "bottom";

export type CommittedInfo = {
  novelId: string;
  finalDir: string;
  outputFiles: string[];
  job: DownloadJob;
};

export type QueueEvent = {
  type: "committed" | "failed" | "canceled";
  job: DownloadJob;
};

export type PersistedQueue = {
  version: 1;
  paused: boolean;
  jobs: DownloadJob[];
};

export type QueuePersistence = {
  load: () => PersistedQueue | null;
  save: (data: PersistedQueue) => void;
};

export type DownloadQueueDeps = {
  runJob: RunJob;
  onCommitted?: (info: CommittedInfo) => void;
  now?: () => number;
  /** Defaults to localStorage (`oghma.queue.v1`); `false` disables persistence. */
  persist?: QueuePersistence | false;
  /**
   * Start processing restored jobs right away (default true). With `false`, the
   * loop waits for `start()` or the first enqueue/resume/retry.
   */
  autoStart?: boolean;
  maxQueued?: number;
  maxCompleted?: number;
};

export type DownloadQueue = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => DownloadQueueSnapshot;
  enqueue: (input: EnqueueInput) => EnqueueResult;
  /** Active: aborts network/disk work and discards staging. Queued: removes it. */
  cancel: (id: string) => boolean;
  /** Pauses the queue; an active job is aborted and returns to the head as "paused". */
  pause: () => void;
  resume: () => void;
  move: (id: string, direction: MoveDirection) => void;
  /** Reorders queued jobs; ids not listed keep their relative order at the end. */
  reorder: (ids: string[]) => void;
  /** Re-queues a finished job (error/canceled/done) at the tail; null if there is no such job. */
  retry: (id: string) => EnqueueResult | null;
  /** Removes a queued or completed job (use cancel for the active one). */
  remove: (id: string) => void;
  clearCompleted: () => void;
  /** Starts the loop (needed once when created with autoStart: false). */
  start: () => void;
  /** Resolves with the job once it is done, failed or canceled. */
  whenSettled: (id: string) => Promise<DownloadJob>;
  onEvent: (listener: (event: QueueEvent) => void) => () => void;
  /** Resolves when the runner loop is idle. */
  idle: () => Promise<void>;
};

const TERMINAL: JobStatus[] = ["done", "error", "canceled"];

function initialProgress(): JobProgress {
  return { stage: "waiting", percent: 0 };
}

function statusForStage(kind: JobKind, stage: JobProgress["stage"], current: JobStatus): JobStatus {
  switch (stage) {
    case "preparing":
    case "fetching":
    case "building":
      return kind === "convert" ? "converting" : "downloading";
    case "saving":
    case "committing":
      return "saving";
    case "converting":
      return "converting";
    default:
      return current;
  }
}

function sameProgress(a: JobProgress, b: JobProgress): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof JobProgress>;
  for (const key of keys) if (a[key] !== b[key]) return false;
  return true;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  return "Falha ao baixar.";
}

function isJobLike(value: unknown): value is DownloadJob {
  const job = value as Partial<DownloadJob> | null;
  return Boolean(
    job &&
      typeof job.id === "string" &&
      typeof job.novelId === "string" &&
      typeof job.title === "string" &&
      job.request &&
      typeof job.request === "object" &&
      Array.isArray(job.request.formats)
  );
}

export const localStoragePersistence: QueuePersistence = {
  load() {
    try {
      const raw = globalThis.localStorage?.getItem(QUEUE_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<PersistedQueue>;
      if (parsed?.version !== 1 || !Array.isArray(parsed.jobs)) return null;
      return { version: 1, paused: Boolean(parsed.paused), jobs: parsed.jobs.filter(isJobLike) };
    } catch {
      return null;
    }
  },
  save(data) {
    try {
      globalThis.localStorage?.setItem(QUEUE_STORAGE_KEY, JSON.stringify(data));
    } catch {
      // Storage full or unavailable: the queue still works in memory.
    }
  }
};

export function createDownloadQueue(deps: DownloadQueueDeps): DownloadQueue {
  const now = deps.now ?? (() => Date.now());
  const persistence = deps.persist === false ? null : deps.persist ?? localStoragePersistence;
  const maxQueued = deps.maxQueued ?? MAX_QUEUED;
  const maxCompleted = deps.maxCompleted ?? MAX_COMPLETED;

  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: QueueEvent) => void>();
  const waiters = new Map<string, Array<(job: DownloadJob) => void>>();
  let idleWaiters: Array<() => void> = [];
  let seq = 0;
  let running = false;
  let started = deps.autoStart ?? true;
  let current: { id: string; controller: AbortController; intent: "pause" | "cancel" | null } | null = null;

  const restored = persistence?.load() ?? null;
  let state: DownloadQueueSnapshot = {
    active: null,
    queued: (restored?.jobs ?? []).slice(0, maxQueued).map((job) => ({
      ...job,
      status: "queued" as const,
      progress: initialProgress(),
      error: undefined,
      startedAt: undefined,
      finishedAt: undefined
    })),
    completed: [],
    paused: restored?.paused ?? false
  };
  if (state.paused && state.queued[0]) state.queued[0] = { ...state.queued[0], status: "paused" };

  function persist() {
    if (!persistence) return;
    const pending = [...(state.active && state.active.status !== "canceled" ? [state.active] : []), ...state.queued];
    persistence.save({
      version: 1,
      paused: state.paused,
      jobs: pending.map((job) => ({
        ...job,
        status: "queued",
        progress: initialProgress(),
        error: undefined,
        startedAt: undefined,
        finishedAt: undefined
      }))
    });
  }

  function setState(next: DownloadQueueSnapshot, structural = true) {
    state = next;
    if (structural) persist();
    for (const listener of Array.from(listeners)) listener();
  }

  function emitEvent(event: QueueEvent) {
    for (const listener of Array.from(eventListeners)) {
      try {
        listener(event);
      } catch {
        // A faulty listener must not break the queue.
      }
    }
    const pending = waiters.get(event.job.id);
    if (pending) {
      waiters.delete(event.job.id);
      pending.forEach((resolve) => resolve(event.job));
    }
  }

  function withCompleted(job: DownloadJob): DownloadJob[] {
    return [job, ...state.completed.filter((entry) => entry.id !== job.id)].slice(0, maxCompleted);
  }

  function newId(): string {
    seq += 1;
    return `job-${now().toString(36)}-${seq}-${Math.random().toString(36).slice(2, 6)}`;
  }

  function findPending(novelId: string): DownloadJob | undefined {
    if (state.active && state.active.novelId === novelId && state.active.status !== "canceled") return state.active;
    return state.queued.find((job) => job.novelId === novelId);
  }

  function updateProgress(id: string, progress: JobProgress) {
    const active = state.active;
    if (!active || active.id !== id || !current || current.id !== id || current.intent) return;
    const status = statusForStage(active.kind, progress.stage, active.status);
    if (status === active.status && sameProgress(active.progress, progress)) return;
    setState({ ...state, active: { ...active, status, progress } }, false);
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      while (started && !state.paused && state.queued.length > 0) {
        const [head, ...rest] = state.queued;
        const controller = new AbortController();
        current = { id: head.id, controller, intent: null };
        const job: DownloadJob = {
          ...head,
          status: head.kind === "convert" ? "converting" : "downloading",
          progress: { stage: "preparing", percent: 0 },
          error: undefined,
          startedAt: now(),
          finishedAt: undefined
        };
        setState({ ...state, active: job, queued: rest });

        let result: JobResult | null = null;
        let failure: unknown = null;
        try {
          result = await deps.runJob(job, {
            signal: controller.signal,
            onProgress: (progress) => updateProgress(job.id, progress)
          });
        } catch (error) {
          failure = error;
        }
        const intent = current?.intent ?? null;
        current = null;
        const latest = state.active && state.active.id === job.id ? state.active : job;
        const finishedProgress = { ...latest.progress, speedBps: undefined, etaSec: undefined };

        if (result) {
          // Committed, even if a cancel/pause arrived after the point of no return.
          const done: DownloadJob = {
            ...latest,
            status: "done",
            progress: { ...finishedProgress, stage: "done", percent: 100 },
            finalDir: result.finalDir,
            outputFiles: result.outputFiles,
            ...(result.warning ? { warning: result.warning } : {}),
            finishedAt: now()
          };
          setState({ ...state, active: null, completed: withCompleted(done) });
          try {
            deps.onCommitted?.({ novelId: done.novelId, finalDir: result.finalDir, outputFiles: result.outputFiles, job: done });
          } catch {
            // Ignore consumer errors.
          }
          emitEvent({ type: "committed", job: done });
        } else if (intent === "pause") {
          const back: DownloadJob = {
            ...latest,
            status: state.paused ? "paused" : "queued",
            progress: initialProgress(),
            startedAt: undefined
          };
          setState({ ...state, active: null, queued: [back, ...state.queued] });
        } else if (intent === "cancel") {
          const canceled: DownloadJob = { ...latest, status: "canceled", progress: finishedProgress, finishedAt: now() };
          setState({ ...state, active: null, completed: withCompleted(canceled) });
          emitEvent({ type: "canceled", job: canceled });
        } else {
          const failed: DownloadJob = {
            ...latest,
            status: "error",
            error: errorMessage(failure),
            progress: finishedProgress,
            finishedAt: now()
          };
          setState({ ...state, active: null, completed: withCompleted(failed) });
          emitEvent({ type: "failed", job: failed });
        }
      }
    } finally {
      running = false;
      const pending = idleWaiters;
      idleWaiters = [];
      pending.forEach((resolve) => resolve());
    }
  }

  function kick() {
    started = true;
    void pump();
  }

  function addJob(job: DownloadJob): EnqueueResult {
    const existing = findPending(job.novelId);
    if (existing) return { result: "duplicate", job: existing };
    if (state.queued.length >= maxQueued) return { result: "full" };
    setState({ ...state, queued: [...state.queued, job] });
    kick();
    return { result: "added", job };
  }

  const queue: DownloadQueue = {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot: () => state,

    enqueue(input) {
      return addJob({
        id: newId(),
        novelId: input.novelId,
        title: input.title,
        coverUrl: input.coverUrl,
        kind: input.kind ?? "download",
        request: input.request,
        status: state.paused && state.queued.length === 0 && !state.active ? "paused" : "queued",
        progress: initialProgress(),
        createdAt: now()
      });
    },

    cancel(id) {
      if (state.active?.id === id && current?.id === id) {
        current.intent = "cancel";
        current.controller.abort();
        setState({ ...state, active: { ...state.active, status: "canceled" } });
        return true;
      }
      const job = state.queued.find((entry) => entry.id === id);
      if (!job) return false;
      const canceled: DownloadJob = { ...job, status: "canceled", finishedAt: now() };
      setState({ ...state, queued: state.queued.filter((entry) => entry.id !== id) });
      emitEvent({ type: "canceled", job: canceled });
      return true;
    },

    pause() {
      if (state.paused) return;
      let active = state.active;
      if (active && current?.id === active.id && !current.intent) {
        current.intent = "pause";
        current.controller.abort();
        active = { ...active, status: "paused" };
      }
      const queued = !active && state.queued[0]
        ? [{ ...state.queued[0], status: "paused" as const }, ...state.queued.slice(1)]
        : state.queued;
      setState({ ...state, paused: true, active, queued });
    },

    resume() {
      const queued = state.queued.map((job) => (job.status === "paused" ? { ...job, status: "queued" as const } : job));
      setState({ ...state, paused: false, queued });
      kick();
    },

    move(id, direction) {
      const index = state.queued.findIndex((job) => job.id === id);
      if (index < 0) return;
      const queued = [...state.queued];
      const [job] = queued.splice(index, 1);
      const target =
        direction === "top" ? 0
        : direction === "bottom" ? queued.length
        : direction === "up" ? Math.max(0, index - 1)
        : Math.min(queued.length, index + 1);
      if (target === index) return;
      queued.splice(target, 0, job);
      setState({ ...state, queued });
    },

    reorder(ids) {
      const byId = new Map(state.queued.map((job) => [job.id, job]));
      const seen = new Set<string>();
      const ordered: DownloadJob[] = [];
      for (const id of ids) {
        const job = byId.get(id);
        if (job && !seen.has(id)) {
          seen.add(id);
          ordered.push(job);
        }
      }
      const queued = [...ordered, ...state.queued.filter((job) => !seen.has(job.id))];
      if (queued.every((job, index) => job === state.queued[index])) return;
      setState({ ...state, queued });
    },

    retry(id) {
      const job = state.completed.find((entry) => entry.id === id);
      if (!job || !TERMINAL.includes(job.status)) return null;
      const outcome = addJob({
        ...job,
        status: "queued",
        progress: initialProgress(),
        error: undefined,
        startedAt: undefined,
        finishedAt: undefined
      });
      if (outcome.result === "added") {
        setState({ ...state, completed: state.completed.filter((entry) => entry.id !== id) });
      }
      return outcome;
    },

    remove(id) {
      if (state.queued.some((job) => job.id === id)) {
        queue.cancel(id);
        return;
      }
      if (state.completed.some((job) => job.id === id)) {
        setState({ ...state, completed: state.completed.filter((job) => job.id !== id) });
      }
    },

    clearCompleted() {
      if (state.completed.length === 0) return;
      setState({ ...state, completed: [] });
    },

    start: kick,

    whenSettled(id) {
      const finished = state.completed.find((job) => job.id === id);
      const pending = state.active?.id === id || state.queued.some((job) => job.id === id);
      if (finished && !pending) return Promise.resolve(finished);
      return new Promise((resolve) => {
        waiters.set(id, [...(waiters.get(id) ?? []), resolve]);
      });
    },

    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },

    idle() {
      if (!running) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    }
  };

  if (started && state.queued.length > 0) void pump();
  return queue;
}

// --- Helpers for wiring the existing QueueItem-based UI ---

type QueueConfig = Pick<AppConfig, "serverUrl" | "outputPath">;

function jobRequestFromItem(item: QueueItem, config: QueueConfig, formats: DownloadFormat[]): DownloadJobRequest {
  return {
    serverUrl: config.serverUrl,
    outputRoot: config.outputPath,
    bundleKey: item.bundleKey,
    bundleSha256: item.bundleSha256,
    author: item.author,
    description: item.description,
    language: item.language,
    formats,
    preset: item.preset,
    rangeStart: item.rangeStart,
    rangeEnd: item.rangeEnd,
    rangeLabel: item.rangeLabel,
    chaptersTotal: item.chaptersTotal,
    translate: item.translate,
    audiobook: item.audiobook,
    coverClass: item.coverClass
  };
}

/** Download job input from a QueueItem (e.g. what backend.createDownloads returns). */
export function downloadInputFromQueueItem(item: QueueItem, config: QueueConfig): EnqueueInput {
  return {
    novelId: item.novelId,
    title: item.title,
    coverUrl: item.coverUrl,
    kind: "download",
    request: jobRequestFromItem(item, config, item.formats)
  };
}

/** Convert job input for a library book (QueueItem from libraryToQueueItems). */
export function convertInputFromQueueItem(
  item: QueueItem,
  config: QueueConfig,
  requestedFormats: DownloadFormat[],
  flags: { translate?: boolean; audiobook?: boolean } = {}
): EnqueueInput {
  return {
    novelId: item.novelId,
    title: item.title,
    coverUrl: item.coverUrl,
    kind: "convert",
    request: {
      ...jobRequestFromItem(item, config, requestedFormats),
      translate: flags.translate ?? item.translate,
      audiobook: flags.audiobook ?? item.audiobook,
      sourceDir: item.outputDir,
      existingFiles: item.outputFiles ?? [],
      existingFormats: item.formats
    }
  };
}

let singleton: DownloadQueue | null = null;

/**
 * App-wide queue configured with the real runner (staging + runDownload + AZW3).
 * Created lazily with autoStart: false: call `start()` once the app has booted so
 * jobs restored from a previous session resume. Listen for finished jobs with
 * `onEvent` (type "committed" → refresh the library).
 */
export function getDownloadQueue(): DownloadQueue {
  singleton ??= createDownloadQueue({ runJob: createJobRunner(), autoStart: false });
  return singleton;
}
