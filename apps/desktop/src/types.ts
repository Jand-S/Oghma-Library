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

export type DownloadFormat = "EPUB" | "PDF" | "TXT";

export const downloadFormats: DownloadFormat[] = ["EPUB", "PDF", "TXT"];

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
  preset: ChapterPreset;
  rangeLabel: string;
  progress: number;
  state: "downloading" | "queued" | "done" | "paused";
  chaptersTotal: number;
  formats: DownloadFormat[];
  translate: boolean;
  audiobook: boolean;
};

export type KindleDeviceStatus = {
  id: string;
  deviceName: string;
  connected: boolean;
  mountPath: string;
  targetFormat: "AZW3";
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
  title: string;
  author: string;
  format: DownloadFormat;
  chapters: number;
  sizeMb: number;
  coverClass: string;
  exportedAt: string;
};

export type Filters = {
  query: string;
  sourceId: string;
  status: string;
  language: string;
  tags: string[];
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
