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
  /** Catalog language from the index ("PT-BR", "EN"); absent on old indexes. */
  language?: string;
  /** Site icon published with the index; the bundled icons in `public/sources/` win. */
  iconUrl?: string;
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
  /** Chapters the site announces; above `chapters` while the server is still collecting the rest. */
  sourceChapters?: number;
  language: string;
  updatedAt: string;
  description: string;
  coverClass: string;
  coverUrl?: string;
  bundleKey?: string;
  bundleVersion?: number;
  bundleSha256?: string;
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
  bundleSha256?: string;
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
  /** How the cable connection works: a mounted disk (older Kindles) or MTP (2021+). */
  transport?: "mass_storage" | "mtp" | "none";
  /** Amazon's "Send to Kindle" app is installed (Wi-Fi sending, macOS). */
  wirelessAvailable?: boolean;
  /** Wi-Fi sending exists on this platform (macOS), installed or not. */
  wirelessSupported?: boolean;
};

export type KindleSendMethod = "wireless" | "usb";

export type ICloudStatus = { available: boolean; root: string };

export type ICloudSaveResult = { savedIds: string[]; paths: string[]; folderPath: string };

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
  /** Set on books produced by the translation screen ("pt-BR"). */
  language?: string;
  /** Novel id of the original book this one was translated from. */
  translatedFrom?: string;
  /** 0–99 while the translated book is only a preview. */
  translationProgress?: number;
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
  /** Catalog sha256 of the bundle; checked while it streams. */
  bundleSha256?: string;
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
