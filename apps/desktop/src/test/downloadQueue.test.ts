import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DownloadJob, JobKind } from "../core/types";
import { createAbortError } from "../services/bundle";
import {
  QUEUE_STORAGE_KEY,
  createDownloadQueue,
  type DownloadQueue,
  type EnqueueInput,
  type JobResult,
  type QueuePersistence
} from "../services/downloadQueue";
import { createJobRunner, type JobRunContext } from "../services/jobRunner";

function input(novelId: string, kind: JobKind = "download", extra: Partial<EnqueueInput["request"]> = {}): EnqueueInput {
  return {
    novelId,
    title: `Livro ${novelId}`,
    coverUrl: `https://cdn.example/${novelId}.jpg`,
    kind,
    request: {
      serverUrl: "https://b2.example",
      outputRoot: "/books",
      bundleKey: `content/${novelId}.tar.gz`,
      formats: ["EPUB"],
      preset: "all",
      rangeLabel: "Todos",
      chaptersTotal: 10,
      translate: false,
      audiobook: false,
      ...extra
    }
  };
}

type Call = {
  job: DownloadJob;
  ctx: JobRunContext;
  resolve: (result: JobResult) => void;
  reject: (error: unknown) => void;
};

// Fake runner: every call stays pending until the test settles it. Aborting the
// signal rejects with an AbortError, like the real runner.
function controllableRunner() {
  const calls: Call[] = [];
  const runJob = vi.fn((job: DownloadJob, ctx: JobRunContext) => new Promise<JobResult>((resolve, reject) => {
    calls.push({ job, ctx, resolve, reject });
    ctx.signal.addEventListener("abort", () => reject(createAbortError()));
  }));
  return { calls, runJob };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function memoryPersistence(): QueuePersistence & { data: ReturnType<QueuePersistence["load"]> } {
  const store = {
    data: null as ReturnType<QueuePersistence["load"]>,
    load: () => store.data,
    save: (data: NonNullable<ReturnType<QueuePersistence["load"]>>) => {
      store.data = JSON.parse(JSON.stringify(data));
    }
  };
  return store;
}

function ids(queue: DownloadQueue) {
  return queue.getSnapshot().queued.map((job) => job.novelId);
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("downloadQueue store", () => {
  it("runs exactly one job at a time, in order", async () => {
    const { calls, runJob } = controllableRunner();
    const onCommitted = vi.fn();
    const queue = createDownloadQueue({ runJob, onCommitted, persist: false });

    expect(queue.enqueue(input("a")).result).toBe("added");
    expect(queue.enqueue(input("b")).result).toBe("added");
    await flush();

    expect(runJob).toHaveBeenCalledTimes(1);
    expect(queue.getSnapshot().active?.novelId).toBe("a");
    expect(queue.getSnapshot().active?.status).toBe("downloading");
    expect(ids(queue)).toEqual(["b"]);

    calls[0].resolve({ finalDir: "/books/Livro a", outputFiles: ["Livro a.epub"] });
    await flush();

    expect(onCommitted).toHaveBeenCalledWith(expect.objectContaining({ novelId: "a", finalDir: "/books/Livro a", outputFiles: ["Livro a.epub"] }));
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().active?.novelId).toBe("b");
    expect(queue.getSnapshot().completed[0]).toMatchObject({ novelId: "a", status: "done", finalDir: "/books/Livro a" });

    calls[1].resolve({ finalDir: "/books/Livro b", outputFiles: [] });
    await queue.idle();
    expect(queue.getSnapshot().active).toBeNull();
    expect(queue.getSnapshot().completed.map((job) => job.novelId)).toEqual(["b", "a"]);
  });

  it("maps runner progress to status and skips no-op updates", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    const listener = vi.fn();
    queue.enqueue(input("a"));
    await flush();
    queue.subscribe(listener);

    calls[0].ctx.onProgress({ stage: "fetching", percent: 30, bytesReceived: 300, bytesTotal: 1000, speedBps: 100, etaSec: 7 });
    expect(queue.getSnapshot().active).toMatchObject({ status: "downloading", progress: { percent: 30, speedBps: 100, etaSec: 7 } });
    calls[0].ctx.onProgress({ stage: "fetching", percent: 30, bytesReceived: 300, bytesTotal: 1000, speedBps: 100, etaSec: 7 });
    expect(listener).toHaveBeenCalledTimes(1);

    calls[0].ctx.onProgress({ stage: "saving", percent: 85 });
    expect(queue.getSnapshot().active?.status).toBe("saving");
    const before = queue.getSnapshot();
    calls[0].ctx.onProgress({ stage: "committing", percent: 99 });
    expect(queue.getSnapshot()).not.toBe(before);
  });

  it("dedupes by novelId against active and queued, and caps the queue", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false, maxQueued: 2 });
    const first = queue.enqueue(input("a"));
    await flush();
    expect(queue.enqueue(input("a"))).toEqual({ result: "duplicate", job: queue.getSnapshot().active });
    queue.enqueue(input("b"));
    expect(queue.enqueue(input("b")).result).toBe("duplicate");
    queue.enqueue(input("c"));
    expect(queue.enqueue(input("d"))).toEqual({ result: "full" });

    calls[0].resolve({ finalDir: "/x", outputFiles: [] });
    await flush();
    // A completed job is not a duplicate: re-download is allowed.
    expect(queue.getSnapshot().completed[0].id).toBe(first.job?.id);
    expect(queue.enqueue(input("a")).result).toBe("added");
  });

  it("cancel on the active job aborts it; queued cancel just removes", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    const events: string[] = [];
    queue.onEvent((event) => events.push(`${event.type}:${event.job.novelId}`));
    const a = queue.enqueue(input("a")).job!;
    const b = queue.enqueue(input("b")).job!;
    const c = queue.enqueue(input("c")).job!;
    await flush();

    expect(queue.cancel(b.id)).toBe(true);
    expect(ids(queue)).toEqual(["c"]);

    const settled = queue.whenSettled(a.id);
    expect(queue.cancel(a.id)).toBe(true);
    expect(calls[0].ctx.signal.aborted).toBe(true);
    expect(queue.getSnapshot().active?.status).toBe("canceled");
    await expect(settled).resolves.toMatchObject({ status: "canceled" });
    await flush();

    expect(events).toEqual(["canceled:b", "canceled:a"]);
    expect(queue.getSnapshot().active?.id).toBe(c.id);
    expect(queue.cancel("missing")).toBe(false);
  });

  it("pause aborts the active job and puts it back at the head; resume restarts it", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    const a = queue.enqueue(input("a")).job!;
    queue.enqueue(input("b"));
    await flush();

    queue.pause();
    expect(calls[0].ctx.signal.aborted).toBe(true);
    await flush();
    const paused = queue.getSnapshot();
    expect(paused.paused).toBe(true);
    expect(paused.active).toBeNull();
    expect(paused.queued.map((job) => [job.novelId, job.status])).toEqual([["a", "paused"], ["b", "queued"]]);
    expect(paused.queued[0].progress.percent).toBe(0);
    expect(runJob).toHaveBeenCalledTimes(1);

    // Enqueue while paused does not start anything.
    queue.enqueue(input("c"));
    await flush();
    expect(runJob).toHaveBeenCalledTimes(1);

    queue.resume();
    await flush();
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().active?.id).toBe(a.id);
    expect(queue.getSnapshot().paused).toBe(false);
  });

  it("moves and reorders queued jobs", async () => {
    const { runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    for (const id of ["a", "b", "c", "d", "e"]) queue.enqueue(input(id));
    await flush();
    const byNovel = (novelId: string) => queue.getSnapshot().queued.find((job) => job.novelId === novelId)!.id;
    expect(ids(queue)).toEqual(["b", "c", "d", "e"]);

    queue.move(byNovel("d"), "up");
    expect(ids(queue)).toEqual(["b", "d", "c", "e"]);
    queue.move(byNovel("b"), "down");
    expect(ids(queue)).toEqual(["d", "b", "c", "e"]);
    queue.move(byNovel("e"), "top");
    expect(ids(queue)).toEqual(["e", "d", "b", "c"]);
    queue.move(byNovel("e"), "bottom");
    expect(ids(queue)).toEqual(["d", "b", "c", "e"]);

    queue.reorder([byNovel("c"), byNovel("e"), "unknown"]);
    expect(ids(queue)).toEqual(["c", "e", "d", "b"]);
  });

  it("retries a failed job", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    const a = queue.enqueue(input("a")).job!;
    await flush();
    calls[0].reject(new Error("HTTP 500"));
    await flush();
    expect(queue.getSnapshot().completed[0]).toMatchObject({ id: a.id, status: "error", error: "HTTP 500" });

    expect(queue.retry(a.id)?.result).toBe("added");
    await flush();
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().active).toMatchObject({ id: a.id, error: undefined });
    expect(queue.getSnapshot().completed).toHaveLength(0);
    expect(queue.retry("missing")).toBeNull();

    calls[1].resolve({ finalDir: "/x", outputFiles: [] });
    await flush();
    queue.remove(a.id);
    expect(queue.getSnapshot().completed).toHaveLength(0);
  });

  it("clearCompleted empties the recent list", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false, maxCompleted: 2 });
    for (const id of ["a", "b", "c"]) queue.enqueue(input(id));
    for (let i = 0; i < 3; i += 1) {
      await flush();
      calls[i].resolve({ finalDir: "/x", outputFiles: [] });
    }
    await queue.idle();
    expect(queue.getSnapshot().completed.map((job) => job.novelId)).toEqual(["c", "b"]);
    queue.clearCompleted();
    expect(queue.getSnapshot().completed).toEqual([]);
  });

  it("persists pending jobs; an interrupted active job comes back at the head", async () => {
    const { runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob });
    queue.enqueue(input("a"));
    queue.enqueue(input("b"));
    await flush();
    expect(queue.getSnapshot().active?.novelId).toBe("a");

    const raw = JSON.parse(localStorage.getItem(QUEUE_STORAGE_KEY) ?? "null");
    expect(raw.jobs.map((job: DownloadJob) => [job.novelId, job.status])).toEqual([["a", "queued"], ["b", "queued"]]);

    const second = controllableRunner();
    const restored = createDownloadQueue({ runJob: second.runJob, autoStart: false });
    expect(restored.getSnapshot().active).toBeNull();
    expect(restored.getSnapshot().queued.map((job) => [job.novelId, job.status, job.progress.percent])).toEqual([
      ["a", "queued", 0],
      ["b", "queued", 0]
    ]);
    await flush();
    expect(second.runJob).not.toHaveBeenCalled();
    restored.start();
    await flush();
    expect(restored.getSnapshot().active?.novelId).toBe("a");
  });

  it("round-trips through a custom persistence, including the paused flag", async () => {
    const persist = memoryPersistence();
    const { runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist });
    queue.pause();
    queue.enqueue(input("a"));
    await flush();
    expect(persist.data).toMatchObject({ version: 1, paused: true });

    const restored = createDownloadQueue({ runJob, persist });
    await flush();
    expect(restored.getSnapshot().paused).toBe(true);
    expect(restored.getSnapshot().queued.map((job) => job.status)).toEqual(["paused"]);
    expect(runJob).not.toHaveBeenCalled();
  });

  it("survives a throwing localStorage", async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new Error("denied");
      }
    });
    try {
      const { runJob } = controllableRunner();
      const queue = createDownloadQueue({ runJob });
      expect(queue.enqueue(input("a")).result).toBe("added");
      await flush();
      expect(runJob).toHaveBeenCalledTimes(1);
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });

  it("runs conversion jobs in the same single slot", async () => {
    const { calls, runJob } = controllableRunner();
    const queue = createDownloadQueue({ runJob, persist: false });
    queue.enqueue(input("a"));
    queue.enqueue(input("b", "convert", { formats: ["AZW3"], sourceDir: "/books/Livro b", existingFormats: ["EPUB"], existingFiles: ["Livro b.epub"] }));
    await flush();
    expect(runJob).toHaveBeenCalledTimes(1);

    calls[0].resolve({ finalDir: "/books/Livro a", outputFiles: [] });
    await flush();
    expect(runJob).toHaveBeenCalledTimes(2);
    expect(queue.getSnapshot().active).toMatchObject({ novelId: "b", kind: "convert", status: "converting" });
  });
});

describe("job runner", () => {
  function runnerMocks() {
    const staging = {
      beginExport: vi.fn(async () => ({ stagingDir: "/books/.oghma-staging/a-1", finalDir: "/books/Livro a" })),
      commitExport: vi.fn(async () => undefined),
      abortExport: vi.fn(async () => undefined)
    };
    const convertAzw3 = vi.fn(async () => "Livro b.azw3");
    return { staging, convertAzw3 };
  }

  it("downloads into staging and commits", async () => {
    const { staging, convertAzw3 } = runnerMocks();
    const runDownload = vi.fn(async () => ["Livro a.epub"]);
    const queue = createDownloadQueue({ runJob: createJobRunner({ staging, runDownload, convertAzw3 }), persist: false });
    const job = queue.enqueue(input("a", "download", { formats: ["EPUB", "AZW3"], preset: "range", rangeStart: 2, rangeEnd: 5 })).job!;
    await expect(queue.whenSettled(job.id)).resolves.toMatchObject({ status: "done", finalDir: "/books/Livro a", outputFiles: ["Livro a.epub"] });

    expect(staging.beginExport).toHaveBeenCalledWith("/books", "a", "Livro a");
    expect(runDownload).toHaveBeenCalledWith(
      expect.objectContaining({ formats: ["EPUB", "AZW3"], outputDir: "/books/.oghma-staging/a-1", range: { start: 2, end: 5 } }),
      expect.objectContaining({ outputDir: "/books/.oghma-staging/a-1", saveCover: true, signal: expect.any(AbortSignal) })
    );
    expect(staging.commitExport).toHaveBeenCalledWith({ stagingDir: "/books/.oghma-staging/a-1", finalDir: "/books/Livro a", novelId: "a" });
    expect(staging.abortExport).not.toHaveBeenCalled();
  });

  it("cancel aborts the signal, calls abortExport and never commitExport", async () => {
    const { staging, convertAzw3 } = runnerMocks();
    let seenSignal: AbortSignal | undefined;
    const runDownload = vi.fn((_req: unknown, opts?: { signal?: AbortSignal }) => new Promise<string[]>((_resolve, reject) => {
      seenSignal = opts?.signal;
      opts?.signal?.addEventListener("abort", () => reject(createAbortError()));
    }));
    const queue = createDownloadQueue({ runJob: createJobRunner({ staging, runDownload, convertAzw3 }), persist: false });
    const job = queue.enqueue(input("a")).job!;
    await flush();
    await flush();
    expect(runDownload).toHaveBeenCalled();

    queue.cancel(job.id);
    await expect(queue.whenSettled(job.id)).resolves.toMatchObject({ status: "canceled" });
    expect(seenSignal?.aborted).toBe(true);
    expect(staging.abortExport).toHaveBeenCalledWith("/books/.oghma-staging/a-1", "/books/Livro a");
    expect(staging.commitExport).not.toHaveBeenCalled();
  });

  it("aborts staging when the download fails", async () => {
    const { staging, convertAzw3 } = runnerMocks();
    const runDownload = vi.fn(async () => {
      throw new Error("HTTP 404");
    });
    const queue = createDownloadQueue({ runJob: createJobRunner({ staging, runDownload, convertAzw3 }), persist: false });
    const job = queue.enqueue(input("a")).job!;
    await expect(queue.whenSettled(job.id)).resolves.toMatchObject({ status: "error", error: "HTTP 404" });
    expect(staging.abortExport).toHaveBeenCalledTimes(1);
    expect(staging.commitExport).not.toHaveBeenCalled();
  });

  it("convert: only AZW3 missing converts the existing EPUB in place", async () => {
    const { staging, convertAzw3 } = runnerMocks();
    const runDownload = vi.fn(async () => []);
    const queue = createDownloadQueue({ runJob: createJobRunner({ staging, runDownload, convertAzw3 }), persist: false });
    const job = queue.enqueue(input("b", "convert", {
      formats: ["AZW3"],
      sourceDir: "/books/Livro b",
      existingFormats: ["EPUB"],
      existingFiles: ["Livro b.epub"]
    })).job!;
    await expect(queue.whenSettled(job.id)).resolves.toMatchObject({
      status: "done",
      finalDir: "/books/Livro b",
      outputFiles: ["Livro b.epub", "Livro b.azw3"]
    });
    expect(convertAzw3).toHaveBeenCalledWith("Livro b", "/books/Livro b", ["Livro b.epub"]);
    expect(runDownload).not.toHaveBeenCalled();
    expect(staging.beginExport).not.toHaveBeenCalled();
  });

  it("convert: other missing formats re-export existing + requested formats through staging", async () => {
    const { staging, convertAzw3 } = runnerMocks();
    const runDownload = vi.fn(async () => ["Livro b.epub", "Livro b.txt"]);
    const queue = createDownloadQueue({ runJob: createJobRunner({ staging, runDownload, convertAzw3 }), persist: false });
    const job = queue.enqueue(input("b", "convert", {
      formats: ["TXT"],
      sourceDir: "/books/Livro b",
      existingFormats: ["EPUB"],
      existingFiles: ["Livro b.epub"]
    })).job!;
    await expect(queue.whenSettled(job.id)).resolves.toMatchObject({ status: "done" });
    expect(runDownload).toHaveBeenCalledWith(expect.objectContaining({ formats: ["EPUB", "TXT"] }), expect.anything());
    expect(staging.commitExport).toHaveBeenCalledTimes(1);
  });
});
