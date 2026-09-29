import type {
  BootstrapPayload,
  Chapter,
  ChapterSelection,
  Filters,
  IndexMode,
  KindleDeviceStatus,
  Novel,
  QueueItem,
  ServerProbe,
  SourceSite,
  TagCatalogItem,
  TranslationCoverage,
  TranslationAutomaticPlan,
  TranslationAutomaticPlanRequest,
  TranslationEstimate,
  TranslationEstimateRequest,
  TranslationJob,
  TranslationJobCreateRequest,
  TranslationMemoryConflict,
  TranslationMemoryConflictResolveRequest,
  TranslationMemoryConflictResolveResult,
  TranslationMemoryConflictSuggestion,
  TranslationMemoryTerm,
  TranslationMemoryTermUpsertRequest,
  TranslationMemoryTermUpsertResult,
  TranslationSelectionRecord
} from "../core/types";

export type KindleTransferResult = {
  sentIds: string[];
  convertedFormat: "AZW3";
};

export type BackendClient = {
  bootstrap(): Promise<BootstrapPayload>;
  searchNovels(filters: Filters): Promise<Novel[]>;
  getTags(sourceId?: string): Promise<TagCatalogItem[]>;
  getNovelChapters(novelId: string): Promise<Chapter[]>;
  syncSource(sourceId: string): Promise<SourceSite>;
  createDownloads(selections: ChapterSelection[]): Promise<QueueItem[]>;
  validateServer(serverUrl: string, indexMode: IndexMode): Promise<ServerProbe>;
  getKindleStatus(): Promise<KindleDeviceStatus>;
  sendToKindle(items: QueueItem[]): Promise<KindleTransferResult>;
  estimateTranslation(request: TranslationEstimateRequest): Promise<TranslationEstimate>;
  getTranslationCoverage(request: TranslationEstimateRequest): Promise<TranslationCoverage>;
  createTranslationJob(request: TranslationJobCreateRequest): Promise<TranslationJob>;
  listTranslationJobs(): Promise<TranslationJob[]>;
  runTranslationJob(jobId: string, allowPaidProviders?: boolean, allowEditorialGrader?: boolean): Promise<TranslationJob>;
  pauseTranslationJob(jobId: string): Promise<TranslationJob>;
  resumeTranslationJob(jobId: string): Promise<TranslationJob>;
  cancelTranslationJob(jobId: string): Promise<TranslationJob>;
  getTranslationAutomaticPlan(request: TranslationAutomaticPlanRequest): Promise<TranslationAutomaticPlan>;
  getTranslationSelectionHistory(novelId?: string): Promise<TranslationSelectionRecord[]>;
  getTranslationMemory(novelId?: string): Promise<TranslationMemoryTerm[]>;
  getTranslationMemoryConflicts(novelId?: string): Promise<TranslationMemoryConflict[]>;
  getTranslationMemoryConflictSuggestions(novelId?: string): Promise<TranslationMemoryConflictSuggestion[]>;
  resolveTranslationMemoryConflict(request: TranslationMemoryConflictResolveRequest): Promise<TranslationMemoryConflictResolveResult>;
  upsertTranslationMemoryTerm(request: TranslationMemoryTermUpsertRequest): Promise<TranslationMemoryTermUpsertResult>;
};

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}
