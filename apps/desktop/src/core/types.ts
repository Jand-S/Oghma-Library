export type ViewId = "discover" | "sources" | "downloads" | "library" | "settings";

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
