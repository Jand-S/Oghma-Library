import type {
  AppConfig,
  DownloadFormat,
  LibraryItem,
  TranslationCoverage,
  TranslationEstimateMode,
  TranslationJob
} from "../../core/types";
import { translationQualityStrings, translationStrings } from "../../strings/translation";
import type { BadgeTone } from "../../ui";

/** Pure types, constants and helpers of the translation workspace (no React). */

export type TranslationScope = "pilot" | "range" | "all";
export type TranslationQuality = "conservative" | "balanced" | "literary";
export type SessionStatus = "ready" | "waiting" | "translating" | "paused" | "done" | "failed" | "cancelled";
export type TranslationTab = "session" | "glossary" | "config";
export type FormatFilter = DownloadFormat | "all";

/** A prepared batch: a chapter range with the settings it was planned with, optionally backed by a job. */
export type TranslationSessionItem = {
  id: string;
  /** Library item id of the project this batch belongs to. */
  projectId: string;
  novelId: string;
  title: string;
  chapters: number;
  chapterFrom: number;
  chapterTo: number;
  scopeLabel: string;
  qualityLabel: string;
  mode: TranslationEstimateMode;
  model: string;
  provider: string;
  workerCount: number;
  estimatedBRL: number;
  estimatedTokens: number;
  sourceChars?: number;
  status: SessionStatus;
  jobId?: string;
  progressPercent?: number;
  actualCostBRL?: number | null;
  actualCostUSD?: number;
  estimatedRemainingBRL?: number | null;
  etaSeconds?: number | null;
  averageSecondsPerChapter?: number;
  retryCount?: number;
  repairCount?: number;
  retryRatePercent?: number;
  repairRatePercent?: number;
  providerStabilityPercent?: number;
  costPerMinuteUSD?: number;
  failedCount?: number;
  effectiveWorkerCount?: number;
  telemetryReason?: string;
};

/** Everything needed to add a batch; built by the planner from the current settings and estimate. */
export type TranslationBatchDraft = Omit<TranslationSessionItem, "id" | "status">;

export type GlossaryTerm = {
  id: string;
  source: string;
  target: string;
  note: string;
};

/** Settings of the next batch; kept in the controller so they survive navigation. */
export type TranslationSettings = {
  scope: TranslationScope;
  rangeStart: number;
  rangeEnd: number;
  quality: TranslationQuality;
  model: string;
  inputUsdPerMillion: string;
  outputUsdPerMillion: string;
  usdBrl: string;
  maxBudgetBrl: string;
  workerCount: number;
  allowPaidProviders: boolean;
  allowEditorialGrader: boolean;
  applyGlossaryToExisting: boolean;
};

export const AUTOMATIC_MODEL = "automatic";
export const PILOT_CHAPTERS = 5;
export const MAX_WORKERS = 8;

export const formatOptions: FormatFilter[] = ["all", "EPUB", "PDF", "TXT", "AZW3"];

export const qualityOptions: Array<{
  value: TranslationQuality;
  label: string;
  detail: string;
  inputTokensPerChapter: number;
  outputTokensPerChapter: number;
}> = [
  { value: "conservative", ...translationQualityStrings.conservative, inputTokensPerChapter: 2600, outputTokensPerChapter: 3100 },
  { value: "balanced", ...translationQualityStrings.balanced, inputTokensPerChapter: 3600, outputTokensPerChapter: 4300 },
  { value: "literary", ...translationQualityStrings.literary, inputTokensPerChapter: 5200, outputTokensPerChapter: 6200 }
];

export const modelOptionsByEngine: Record<AppConfig["translationEngine"], string[]> = {
  openai: ["gpt-5.4-mini", "gpt-4.1-mini", "gpt-5.4-nano"],
  local: ["local-quality", "local-balanced"],
  deepl: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"],
  google: ["google/gemini-3-flash-preview", "google/gemini-3.1-flash-lite"]
};

export function defaultSettings(engine: AppConfig["translationEngine"]): TranslationSettings {
  return {
    scope: "pilot",
    rangeStart: 1,
    rangeEnd: PILOT_CHAPTERS,
    quality: "literary",
    model: modelOptionsByEngine[engine][0],
    inputUsdPerMillion: "0,00",
    outputUsdPerMillion: "0,00",
    usdBrl: "5,50",
    maxBudgetBrl: "",
    workerCount: 1,
    allowPaidProviders: false,
    allowEditorialGrader: false,
    applyGlossaryToExisting: false
  };
}

export const currencyBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const currencyUSD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD" });

export function parseDecimal(value: string) {
  const parsed = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function projectKey(item: LibraryItem) {
  return item.novelId ?? item.id;
}

export function formatsFor(item: LibraryItem) {
  return item.formats?.length ? item.formats : [item.format];
}

export function hasFormat(item: LibraryItem, format: FormatFilter) {
  return format === "all" || formatsFor(item).includes(format);
}

export function matchesQuery(item: LibraryItem, query: string) {
  const normalized = query.trim().toLowerCase();
  return normalized.length === 0
    || item.title.toLowerCase().includes(normalized)
    || item.author.toLowerCase().includes(normalized)
    || Boolean(item.sourceName?.toLowerCase().includes(normalized));
}

export function clampChapter(value: number, max: number) {
  return Math.max(1, Math.min(max, Number.isFinite(value) ? value : 1));
}

export function plannerMode(quality: TranslationQuality): TranslationEstimateMode {
  if (quality === "conservative") return "economy";
  if (quality === "literary") return "quality";
  return "balanced";
}

export function durationLabel(seconds: number | null | undefined) {
  if (!seconds) return translationStrings.noHistory;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function coverageRangeLabel(ranges: TranslationCoverage["ranges"]) {
  if (ranges.length === 0) return translationStrings.noRanges;
  const shown = ranges.slice(0, 3).map((range) => (range.start === range.end ? `${range.start}` : `${range.start}–${range.end}`));
  return ranges.length > shown.length ? `${shown.join(", ")} +${ranges.length - shown.length}` : shown.join(", ");
}

export function providerForModel(model: string, engine: AppConfig["translationEngine"]) {
  if (model.startsWith("google/") || model.startsWith("deepseek/") || model.startsWith("anthropic/")) return "openrouter";
  if (model.startsWith("gpt-")) return "openai";
  if (engine === "local") return "fake";
  return engine;
}

export function modelLabel(model: string) {
  return model === AUTOMATIC_MODEL ? translationStrings.automaticModelShort : model;
}

export function sessionStatusFromJob(job: TranslationJob): SessionStatus {
  if (job.status === "translating" || job.status === "paused" || job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return job.status;
  }
  return "waiting";
}

export function patchSessionFromJob(item: TranslationSessionItem, job: TranslationJob): TranslationSessionItem {
  return {
    ...item,
    jobId: job.id,
    status: sessionStatusFromJob(job),
    progressPercent: job.stats.progressPercent,
    actualCostUSD: job.stats.actualCostUsd,
    actualCostBRL: job.stats.actualCostBrl,
    estimatedRemainingBRL: job.stats.estimatedRemainingCostBrl,
    etaSeconds: job.stats.etaSeconds,
    averageSecondsPerChapter: job.stats.averageSecondsPerChapter,
    retryCount: job.stats.retryCount,
    repairCount: job.stats.repairCount,
    retryRatePercent: job.stats.retryRatePercent,
    repairRatePercent: job.stats.repairRatePercent,
    providerStabilityPercent: job.stats.providerStabilityPercent,
    costPerMinuteUSD: job.stats.costPerMinuteUsd,
    failedCount: job.stats.failedCount,
    effectiveWorkerCount: job.stats.effectiveWorkerCount,
    telemetryReason: job.stats.telemetryReason
  };
}

export const batchStatusTone: Record<SessionStatus, BadgeTone> = {
  ready: "accent",
  waiting: "neutral",
  translating: "accent",
  paused: "warning",
  done: "success",
  failed: "danger",
  cancelled: "neutral"
};

export type ProjectStatus = {
  label: string;
  tone: BadgeTone;
  /** Average job progress (0–100) when at least one batch has a job. */
  progress: number | null;
  active: boolean;
};

/** Summarizes the batches of one project into a single status for its card. */
export function projectStatus(items: TranslationSessionItem[]): ProjectStatus {
  if (items.length === 0) return { label: translationStrings.statusIdle, tone: "neutral", progress: null, active: false };
  const withJobs = items.filter((item) => item.jobId);
  const progress = withJobs.length
    ? withJobs.reduce((total, item) => total + (item.progressPercent ?? 0), 0) / withJobs.length
    : null;
  const has = (status: SessionStatus) => items.some((item) => item.status === status);
  if (has("translating")) return { label: translationStrings.statusTranslating, tone: "accent", progress, active: true };
  if (has("failed")) return { label: translationStrings.statusFailed, tone: "danger", progress, active: false };
  if (has("paused")) return { label: translationStrings.statusPaused, tone: "warning", progress, active: false };
  if (has("waiting")) return { label: translationStrings.statusWaiting, tone: "neutral", progress, active: true };
  const ready = items.filter((item) => item.status === "ready").length;
  if (ready) return { label: translationStrings.statusReady(ready), tone: "accent", progress, active: false };
  if (items.every((item) => item.status === "cancelled")) return { label: translationStrings.statusCancelled, tone: "neutral", progress, active: false };
  return { label: translationStrings.statusDone, tone: "success", progress, active: false };
}

export function conflictKey(source: string, relatedSource: string, conflictType: string) {
  return `${conflictType}:${[source.toLowerCase(), relatedSource.toLowerCase()].sort().join(":")}`;
}
