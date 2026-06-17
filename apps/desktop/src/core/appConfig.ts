import { downloadFormats } from "./types";
import type { AppConfig, DownloadFormat, IndexMode, TranslationEngine } from "./types";

export const setupStorageKey = "oghma.setup.v1";
export const setupCompleteKey = "oghma.setup.complete.v1";

const defaultOutputPath = "~/Documents/Oghma Library/exports";
const defaultFormats: DownloadFormat[] = ["EPUB"];
const translationEngines: TranslationEngine[] = ["local", "openai", "deepl", "google"];
const indexModes: IndexMode[] = ["catalog_only", "incremental_recent", "guarded_refresh"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDownloadFormat(value: unknown): value is DownloadFormat {
  return typeof value === "string" && downloadFormats.includes(value as DownloadFormat);
}

function isTranslationEngine(value: unknown): value is TranslationEngine {
  return typeof value === "string" && translationEngines.includes(value as TranslationEngine);
}

function isIndexMode(value: unknown): value is IndexMode {
  return typeof value === "string" && indexModes.includes(value as IndexMode);
}

export function defaultAppConfig(sourceIds: string[] = []): AppConfig {
  return {
    serverUrl: "https://b2.jandson.me",
    outputPath: defaultOutputPath,
    enabledSourceIds: sourceIds,
    indexMode: "incremental_recent",
    defaultFormats,
    translateDefault: false,
    audiobookDefault: false,
    targetLanguage: "PT-BR",
    translationEngine: "local",
    ttsVoice: "pt-BR-Antonio",
    ttsSpeed: 1,
    audioFormat: "M4B",
    syncOnLaunch: true
  };
}

export function normalizeStoredAppConfig(value: unknown): Partial<AppConfig> | null {
  if (!isRecord(value)) return null;

  const next: Partial<AppConfig> = {};

  if (typeof value.serverUrl === "string") next.serverUrl = value.serverUrl;
  if (typeof value.outputPath === "string") next.outputPath = value.outputPath;
  if (Array.isArray(value.enabledSourceIds)) {
    next.enabledSourceIds = value.enabledSourceIds.filter((item): item is string => typeof item === "string");
  }
  if (isIndexMode(value.indexMode)) next.indexMode = value.indexMode;
  if (Array.isArray(value.defaultFormats)) {
    const formats = value.defaultFormats.filter(isDownloadFormat);
    if (formats.length > 0) next.defaultFormats = formats;
  }
  if (typeof value.translateDefault === "boolean") next.translateDefault = value.translateDefault;
  if (typeof value.audiobookDefault === "boolean") next.audiobookDefault = value.audiobookDefault;
  if (typeof value.targetLanguage === "string") next.targetLanguage = value.targetLanguage;
  if (isTranslationEngine(value.translationEngine)) next.translationEngine = value.translationEngine;
  if (typeof value.ttsVoice === "string") next.ttsVoice = value.ttsVoice;
  if (typeof value.ttsSpeed === "number" && Number.isFinite(value.ttsSpeed)) next.ttsSpeed = value.ttsSpeed;
  if (typeof value.audioFormat === "string") next.audioFormat = value.audioFormat;
  if (typeof value.syncOnLaunch === "boolean") next.syncOnLaunch = value.syncOnLaunch;

  return next;
}

export function resolveAppConfig(stored: Partial<AppConfig> | null, fallbackSourceIds: string[] = []): AppConfig {
  const defaults = defaultAppConfig(fallbackSourceIds);
  if (!stored) return defaults;

  return {
    ...defaults,
    ...stored,
    enabledSourceIds: stored.enabledSourceIds && stored.enabledSourceIds.length > 0
      ? stored.enabledSourceIds
      : defaults.enabledSourceIds,
    defaultFormats: stored.defaultFormats && stored.defaultFormats.length > 0
      ? stored.defaultFormats
      : defaults.defaultFormats
  };
}

export function readStoredConfig() {
  const raw = window.localStorage.getItem(setupStorageKey);
  if (!raw) return null;
  try {
    return normalizeStoredAppConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeStoredConfig(config: AppConfig) {
  window.localStorage.setItem(setupStorageKey, JSON.stringify(config));
}

export function hasCompletedSetup() {
  return window.localStorage.getItem(setupCompleteKey) === "1";
}

export function markSetupComplete() {
  window.localStorage.setItem(setupCompleteKey, "1");
}
