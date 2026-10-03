// Runs one queue job end to end. Download and convert jobs both go through the
// export staging dir, so the book folder is only ever replaced atomically.
import type { DownloadFormat, DownloadJob, JobProgress } from "../core/types";
import { throwIfAborted } from "./bundle";
import { runDownload } from "./downloadManager";
import { exportStaging, type ExportStaging } from "./exportStaging";
import { convertLocalEpubToAzw3 } from "./localFiles";

export type JobRunContext = {
  signal: AbortSignal;
  onProgress: (progress: JobProgress) => void;
};

export type JobResult = {
  finalDir: string;
  outputFiles: string[];
  /** Saved, but with something the user should know (chapters unavailable at the source). */
  warning?: string;
};

export type RunJob = (job: DownloadJob, ctx: JobRunContext) => Promise<JobResult>;

export type JobRunnerDeps = {
  staging: ExportStaging;
  runDownload: typeof runDownload;
  convertAzw3: typeof convertLocalEpubToAzw3;
};

const defaultDeps: JobRunnerDeps = {
  staging: exportStaging,
  runDownload,
  convertAzw3: convertLocalEpubToAzw3
};

function jobRange(job: DownloadJob): { start: number; end: number } | undefined {
  const { preset, rangeStart, rangeEnd } = job.request;
  return preset === "range" && rangeStart && rangeEnd ? { start: rangeStart, end: rangeEnd } : undefined;
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function createJobRunner(overrides: Partial<JobRunnerDeps> = {}): RunJob {
  const deps: JobRunnerDeps = { ...defaultDeps, ...overrides };

  // beginExport -> runDownload into staging (EPUB/TXT/HTML, cover.<ext>, manifest,
  // then AZW3 inside staging so the cover is embedded) -> commitExport.
  // Any failure or abort before commit deletes the staging dir.
  async function exportBook(job: DownloadJob, formats: DownloadFormat[], ctx: JobRunContext): Promise<JobResult> {
    const { signal } = ctx;
    ctx.onProgress({ stage: "preparing", percent: 0 });
    throwIfAborted(signal);
    const stage = await deps.staging.beginExport(job.request.outputRoot, job.novelId, job.title);
    let warning: string | undefined;
    try {
      throwIfAborted(signal);
      const outputFiles = await deps.runDownload(
        {
          serverUrl: job.request.serverUrl,
          novel: { id: job.novelId, title: job.title, bundleKey: job.request.bundleKey, bundleSha256: job.request.bundleSha256, coverUrl: job.coverUrl },
          formats,
          outputDir: stage.stagingDir,
          range: jobRange(job)
        },
        {
          signal,
          outputDir: stage.stagingDir,
          saveCover: true,
          onWarning: (message) => {
            warning = message;
          },
          onProgress: (_percent, detail) => {
            // Keep the last percent for the commit step.
            if (detail.stage === "done") return;
            ctx.onProgress({ ...detail, percent: Math.min(detail.percent, 98) });
          }
        }
      );
      // Last chance to cancel: once commit starts the swap is atomic and final.
      throwIfAborted(signal);
      ctx.onProgress({ stage: "committing", percent: 99 });
      await deps.staging.commitExport({ ...stage, novelId: job.novelId });
      return { finalDir: stage.finalDir, outputFiles, ...(warning ? { warning } : {}) };
    } catch (error) {
      await deps.staging.abortExport(stage.stagingDir, stage.finalDir).catch(() => undefined);
      throw error;
    }
  }

  // Equivalent of the old useConversionManager flow, serialized through the queue:
  // - nothing missing: no-op;
  // - only AZW3 missing and an EPUB exists: convert in place (adds one file);
  // - otherwise: re-export the book with existing + requested formats via staging.
  async function convertBook(job: DownloadJob, ctx: JobRunContext): Promise<JobResult> {
    const { request } = job;
    const existingFormats = request.existingFormats ?? [];
    const existingFiles = request.existingFiles ?? [];
    const missing = request.formats.filter((format) => !existingFormats.includes(format));
    if (missing.length === 0 && request.sourceDir) {
      return { finalDir: request.sourceDir, outputFiles: existingFiles };
    }
    const hasEpub = existingFiles.some((file) => file.toLowerCase().endsWith(".epub"));
    if (request.sourceDir && hasEpub && missing.every((format) => format === "AZW3")) {
      throwIfAborted(ctx.signal);
      ctx.onProgress({ stage: "converting", percent: 10 });
      const azw3 = await deps.convertAzw3(job.title, request.sourceDir, existingFiles);
      if (!azw3) throw new Error("A conversão para AZW3 só está disponível no app desktop.");
      return { finalDir: request.sourceDir, outputFiles: unique([...existingFiles, azw3]) };
    }
    return exportBook(job, unique([...existingFormats, ...request.formats]), ctx);
  }

  return (job, ctx) => (job.kind === "convert" ? convertBook(job, ctx) : exportBook(job, job.request.formats, ctx));
}
