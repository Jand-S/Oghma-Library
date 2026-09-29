export type ViewId = "discover" | "sources" | "downloads" | "library" | "translation" | "settings";

export type SourceStatus = "online" | "syncing" | "offline";

export type SourceSite = {
  id: string;
  name: string;
  baseUrl: string;
  count: number;
  status: SourceStatus;
  enabled: boolean;
  mode: "static_html" | "javascript_required" | "api_available";
  lastSync: string;
  delayMs: number;
};

export type NovelStatus = "ongoing" | "complete" | "paused";

export type Novel = {
  id: string;
  title: string;
  author: string;
  sourceId: string;
  sourceName: string;
  tags: string[];
  tagKeys: string[];
  status: NovelStatus;
  chapters: number;
  language: string;
  updatedAt: string;
  description: string;
  coverClass: string;
  coverUrl?: string;
  bundleKey?: string;
  bundleVersion?: number;
};

export type Chapter = {
  id: string;
  novelId: string;
  number: number;
  title: string;
  pages: number;
  sizeMb: number;
  downloaded: boolean;
};

export type ChapterPreset = "all" | "range";

export type DownloadFormat = "EPUB" | "PDF" | "TXT" | "AZW3";

export const downloadFormats: DownloadFormat[] = ["EPUB", "PDF", "TXT", "AZW3"];

export type IndexMode = "catalog_only" | "incremental_recent" | "guarded_refresh";

export type TranslationEngine = "deepl" | "google" | "openai" | "local";

export type TranslationEstimateMode = "economy" | "balanced" | "quality" | "fast";

export type TranslationModelRecommendation = {
  model: string;
  estimatedUsd: number;
  estimatedBrl?: number | null;
  estimatedDurationSeconds?: number | null;
  qualityScore?: number | null;
  gatePassRate?: number | null;
  recommendationScore: number;
  experimental: boolean;
  priceTimestamp: string;
  notes: string[];
};

export type TranslationEstimateRequest = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  mode: TranslationEstimateMode;
  models?: string[] | null;
  usdBrlRate?: number | null;
  sourceChars?: number | null;
};

export type TranslationEstimate = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  chapterCount: number;
  sourceChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  mode: TranslationEstimateMode;
  recommendations: TranslationModelRecommendation[];
};

export type TranslationCoverageRange = {
  start: number;
  end: number;
  count: number;
  freshness: "fresh" | "stale" | "unknown" | string;
};

export type TranslationCoverage = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  targetLanguage: string;
  selectedCount: number;
  translatedCount: number;
  missingCount: number;
  staleCount: number;
  unknownCount: number;
  coveragePercent: number;
  ranges: TranslationCoverageRange[];
  staleRanges: TranslationCoverageRange[];
  unknownRanges: TranslationCoverageRange[];
  estimatedSavingsUsd: number;
  estimatedSavingsBrl?: number | null;
};

export type TranslationJobCreateRequest = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  targetLanguage: string;
  mode: TranslationEstimateMode;
  strategy: "manual" | "automatic" | string;
  selectedModel: string;
  provider: string;
  workerCount: number;
  reuseExisting: boolean;
  maxCostUsd?: number | null;
  usdBrlRate?: number | null;
  sourceChars?: number | null;
};

export type TranslationJobStats = {
  selectedCount: number;
  translatedCount: number;
  reusableCount: number;
  missingCount: number;
  staleCount: number;
  unknownCount: number;
  estimatedSavingsUsd: number;
  estimatedSavingsBrl?: number | null;
  estimatedCostUsd: number;
  estimatedCostBrl?: number | null;
  actualCostUsd: number;
  actualCostBrl?: number | null;
  estimatedRemainingCostUsd: number;
  estimatedRemainingCostBrl?: number | null;
  averageCostUsdPerChapter: number;
  averageInputTokensPerChapter: number;
  averageOutputTokensPerChapter: number;
  outputInputRatio: number;
  averageSecondsPerChapter: number;
  costPerMinuteUsd: number;
  elapsedSeconds: number;
  etaSeconds?: number | null;
  retryCount: number;
  repairCount: number;
  failedCount: number;
  rateLimitCount: number;
  retryRatePercent: number;
  repairRatePercent: number;
  providerStabilityPercent: number;
  effectiveWorkerCount: number;
  telemetryReason: string;
  progressPercent: number;
  coverageRanges: TranslationCoverageRange[];
};

export type TranslationJob = {
  id: string;
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  targetLanguage: string;
  mode: TranslationEstimateMode;
  strategy: string;
  status: "queued" | "planning" | "sampling" | "translating" | "repairing" | "paused" | "failed" | "done" | "cancelled" | string;
  selectedModel: string;
  provider: string;
  workerCount: number;
  reuseExisting: boolean;
  maxCostUsd?: number | null;
  stats: TranslationJobStats;
  error: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
};

export type TranslationAutomaticSample = {
  id: string;
  number: number;
  reason: string;
  sourceChars: number;
  wordCount: number;
};

export type TranslationAutomaticPlanRequest = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  mode: TranslationEstimateMode;
  candidateModels?: string[] | null;
  graderModels?: string[] | null;
  maxSamples: number;
  maxModels: number;
  usdBrlRate?: number | null;
  sourceChars?: number | null;
};

export type TranslationAutomaticPlan = {
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  mode: TranslationEstimateMode;
  sampleChapters: TranslationAutomaticSample[];
  candidateModels: string[];
  estimatedSampleUsd: number;
  estimatedSampleBrl?: number | null;
  estimatedEditorialGraderUsd: number;
  estimatedEditorialGraderBrl?: number | null;
  recommendations: TranslationModelRecommendation[];
};

export type TranslationSelectionTrial = {
  model: string;
  provider: string;
  averageScore: number;
  totalCostUsd: number;
  totalDurationSeconds: number;
  failureCount: number;
};

export type TranslationSelectionRecord = {
  id: string;
  jobId: string;
  novelId: string;
  chapterFrom: number;
  chapterTo: number;
  targetLanguage: string;
  mode: TranslationEstimateMode;
  winnerModel: string;
  winnerProvider: string;
  editorialGradeCount: number;
  editorialCostUsd: number;
  sampleChapters: number[];
  trials: TranslationSelectionTrial[];
  createdAt: string;
};

export type TranslationMemoryTerm = {
  novelId: string;
  source: string;
  target: string;
  status: string;
  category: string;
  occurrences: number;
  firstChapter?: number | null;
  lastChapter?: number | null;
  confidence: number;
  notes: string;
  updatedAt: string;
};

export type TranslationMemoryConflict = {
  novelId: string;
  conflictType: "same_source_different_target" | "same_target_different_source" | "near_duplicate_source" | string;
  severity: "high" | "medium" | "low" | string;
  source: string;
  target: string;
  relatedSource: string;
  relatedTarget: string;
  message: string;
};

export type TranslationMemoryConflictSuggestion = {
  novelId: string;
  conflictType: string;
  severity: string;
  source: string;
  currentTarget: string;
  suggestedTarget: string;
  relatedSource: string;
  relatedTarget: string;
  confidence: number;
  action: "lock_source_target" | "lock_variant_target" | "review_only" | string;
  reason: string;
};

export type TranslationMemoryConflictResolveRequest = {
  novelId: string;
  source: string;
  target: string;
  targetLanguage: string;
  applyExisting: boolean;
};

export type TranslationMemoryConflictResolveResult = {
  term: TranslationMemoryTerm;
  postEdit?: TranslationPostEditResult | null;
  remainingConflictCount: number;
};

export type TranslationMemoryTermUpsertRequest = {
  novelId: string;
  source: string;
  target: string;
  targetLanguage: string;
  status: string;
  category: string;
  notes: string;
  applyExisting: boolean;
};

export type TranslationPostEditResult = {
  scannedCount: number;
  changedCount: number;
  skippedCount: number;
  changedPaths: string[];
};

export type TranslationMemoryTermUpsertResult = {
  term: TranslationMemoryTerm;
  postEdit?: TranslationPostEditResult | null;
};

export type ChapterSelection = {
  novelId: string;
  preset: ChapterPreset;
  start: number;
  end: number;
  formats: DownloadFormat[];
  translate: boolean;
  audiobook: boolean;
};

export type QueueItem = {
  id: string;
  novelId: string;
  title: string;
  coverClass: string;
  coverUrl?: string;
  bundleKey?: string;
  preset: ChapterPreset;
  rangeStart?: number;
  rangeEnd?: number;
  rangeLabel: string;
  progress: number;
  state: "downloading" | "queued" | "done" | "paused" | "error";
  chaptersTotal: number;
  formats: DownloadFormat[];
  translate: boolean;
  audiobook: boolean;
  outputDir?: string;
  outputFiles?: string[];
  error?: string;
};

export type KindleDeviceStatus = {
  id: string;
  deviceName: string;
  connected: boolean;
  mountPath: string;
  targetFormat: "AZW3";
  converterAvailable?: boolean;
};

export type ServerProbe = {
  serverUrl: string;
  status: "online";
  serverName: string;
  version: string;
  latencyMs: number;
  sourceCount: number;
  storageRoot: string;
};

export type AppConfig = {
  serverUrl: string;
  outputPath: string;
  enabledSourceIds: string[];
  indexMode: IndexMode;
  defaultFormats: DownloadFormat[];
  translateDefault: boolean;
  audiobookDefault: boolean;
  targetLanguage: string;
  translationEngine: TranslationEngine;
  ttsVoice: string;
  ttsSpeed: number;
  audioFormat: string;
  syncOnLaunch: boolean;
};

export type LibraryItem = {
  id: string;
  novelId?: string;
  title: string;
  author: string;
  format: DownloadFormat;
  formats?: DownloadFormat[];
  chapters: number;
  sizeMb: number;
  sourceChars?: number;
  wordCount?: number;
  analysisFormat?: string;
  coverClass: string;
  coverUrl?: string;
  bundleKey?: string;
  description?: string;
  sourceName?: string;
  outputDir?: string;
  files?: string[];
  exportedAt: string;
  favorite?: boolean;
  readingStatus?: LibraryReadingStatus;
  personalTags?: string[];
  hidden?: boolean;
};

export type LibraryReadingStatus = "unread" | "reading" | "paused" | "completed" | "dropped";

export type LibraryMeta = {
  key: string;
  favorite: boolean;
  readingStatus: LibraryReadingStatus;
  tags: string[];
  hidden: boolean;
};

export type TagCategory = "format" | "genre" | "theme";
export type ContentRatingFilter = "all" | "safe" | "suggestive" | "erotic";

export type TagCatalogItem = {
  key: string;
  label: string;
  category: TagCategory;
  aliases: string[];
  count: number;
  reviewStatus?: "curated" | "inferred" | "unknown";
};

export type Filters = {
  query: string;
  sourceId: string;
  status: string;
  language: string;
  contentRating: ContentRatingFilter;
  includeTags: string[];
  excludeTags: string[];
  onlyCovered: boolean;
  updatedOnly: boolean;
  minChapters: number;
  maxChapters: number;
};

export type BootstrapPayload = {
  sources: SourceSite[];
  novels: Novel[];
  queue: QueueItem[];
  library: LibraryItem[];
};

// --- Download queue (services/downloadQueue.ts) ---

export type JobKind = "download" | "convert";

export type JobStatus =
  | "queued"
  | "downloading"
  | "converting"
  | "saving"
  | "paused"
  | "done"
  | "error"
  | "canceled";

/** Fine-grained step inside a running job. */
export type JobStage =
  | "waiting"
  | "preparing"
  | "fetching"
  | "building"
  | "saving"
  | "converting"
  | "committing"
  | "done";

export type JobProgress = {
  stage: JobStage;
  /** 0..100 for the whole job. */
  percent: number;
  bytesReceived?: number;
  bytesTotal?: number;
  /** Smoothed (EWMA) network speed in bytes per second. */
  speedBps?: number;
  /** Estimated seconds left for the network transfer. */
  etaSec?: number;
  chaptersDone?: number;
  chaptersTotal?: number;
};

/** Everything the runner needs; mirrors QueueItem plus the config captured at enqueue time. */
export type DownloadJobRequest = {
  serverUrl: string;
  /** Library root (AppConfig.outputPath). The book folder is resolved by begin_export. */
  outputRoot: string;
  bundleKey?: string;
  formats: DownloadFormat[];
  preset: ChapterPreset;
  rangeStart?: number;
  rangeEnd?: number;
  rangeLabel: string;
  chaptersTotal: number;
  translate: boolean;
  audiobook: boolean;
  coverClass?: string;
  /** kind "convert": folder that already holds the book. */
  sourceDir?: string;
  /** kind "convert": files already present in sourceDir. */
  existingFiles?: string[];
  /** kind "convert": formats already present in sourceDir. */
  existingFormats?: DownloadFormat[];
};

export type DownloadJob = {
  id: string;
  novelId: string;
  title: string;
  coverUrl?: string;
  kind: JobKind;
  request: DownloadJobRequest;
  status: JobStatus;
  progress: JobProgress;
  error?: string;
  outputFiles?: string[];
  finalDir?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
};

export type EnqueueResult = {
  result: "added" | "duplicate" | "full";
  /** The new job ("added") or the job already covering this novel ("duplicate"). */
  job?: DownloadJob;
};

export type DownloadQueueSnapshot = {
  active: DownloadJob | null;
  queued: DownloadJob[];
  completed: DownloadJob[];
  paused: boolean;
};
