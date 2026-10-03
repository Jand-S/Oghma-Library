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
  TagCatalogItem
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
  /** Sources straight from the index (no catalogs): name, language, count and icon of a source not loaded yet. */
  listIndexSources?(): Promise<SourceSite[]>;
  createDownloads(selections: ChapterSelection[]): Promise<QueueItem[]>;
  validateServer(serverUrl: string, indexMode: IndexMode): Promise<ServerProbe>;
  getKindleStatus(): Promise<KindleDeviceStatus>;
  sendToKindle(items: QueueItem[]): Promise<KindleTransferResult>;
};

export function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  if (typeof error === "string" && error.trim().length > 0) return error;
  return fallback;
}
