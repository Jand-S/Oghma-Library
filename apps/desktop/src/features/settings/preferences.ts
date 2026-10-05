import { useCallback, useState } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { ChapterPreset, KindleSendMethod } from "../../core/types";
import type { TranslationEffort, TranslationModelId } from "../../services/translationClient";

/**
 * UI preferences that are not part of `AppConfig` (which is shared with the backend
 * flows): start page and default chapter preset. Stored under their own key so the
 * config schema stays unchanged.
 */
export type StartPage = Extract<AppView, "home" | "discover" | "library" | "downloads" | "kindle">;

export type UiPreferences = {
  startPage: StartPage;
  chapterPreset: ChapterPreset;
};

export const uiPreferencesKey = "oghma.prefs.v1";
export const startPages: StartPage[] = ["home", "discover", "library", "downloads", "kindle"];
const chapterPresets: ChapterPreset[] = ["all", "range"];

export const defaultUiPreferences: UiPreferences = { startPage: "home", chapterPreset: "all" };

export function readUiPreferences(): UiPreferences {
  try {
    const raw = window.localStorage.getItem(uiPreferencesKey);
    if (!raw) return defaultUiPreferences;
    const value = JSON.parse(raw) as Partial<Record<keyof UiPreferences, unknown>>;
    return {
      startPage: startPages.includes(value.startPage as StartPage) ? (value.startPage as StartPage) : defaultUiPreferences.startPage,
      chapterPreset: chapterPresets.includes(value.chapterPreset as ChapterPreset)
        ? (value.chapterPreset as ChapterPreset)
        : defaultUiPreferences.chapterPreset
    };
  } catch {
    return defaultUiPreferences;
  }
}

export function writeUiPreferences(preferences: UiPreferences) {
  try {
    window.localStorage.setItem(uiPreferencesKey, JSON.stringify(preferences));
  } catch {
    // Storage unavailable: the preference only lasts for this session.
  }
}

/** Reads the preferences once and writes every change straight to storage. */
export function useUiPreferences() {
  const [preferences, setPreferences] = useState(readUiPreferences);
  const update = useCallback((patch: Partial<UiPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeUiPreferences(next);
      return next;
    });
  }, []);
  return [preferences, update] as const;
}

/**
 * Defaults for new translation projects (Ajustes → Áudio e tradução). They are passed to
 * `translation_update_settings` right after `translation_create_project`.
 */
export type TranslationPreferences = {
  model: TranslationModelId;
  effort: TranslationEffort;
  workers: number;
};

export const translationPreferencesKey = "oghma.translation.prefs.v1";
export const translationModels: TranslationModelId[] = ["gpt-6-luna", "gpt-6-sol"];
export const translationEfforts: TranslationEffort[] = ["none", "low"];
/** Matches `MAX_WORKERS` in the Rust runner. */
export const TRANSLATION_WORKERS_MAX = 6;
export type WorkerCount = `${number}`;

export const defaultTranslationPreferences: TranslationPreferences = {
  model: "gpt-6-luna",
  effort: "none",
  workers: 2
};

function clampInt(value: unknown, min: number, max: number, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function readTranslationPreferences(): TranslationPreferences {
  try {
    const raw = window.localStorage.getItem(translationPreferencesKey);
    if (!raw) return defaultTranslationPreferences;
    const value = JSON.parse(raw) as Partial<Record<keyof TranslationPreferences, unknown>>;
    const d = defaultTranslationPreferences;
    return {
      model: translationModels.includes(value.model as TranslationModelId) ? (value.model as TranslationModelId) : d.model,
      effort: translationEfforts.includes(value.effort as TranslationEffort) ? (value.effort as TranslationEffort) : d.effort,
      workers: clampInt(value.workers, 1, TRANSLATION_WORKERS_MAX, d.workers)
    };
  } catch {
    return defaultTranslationPreferences;
  }
}

export function writeTranslationPreferences(preferences: TranslationPreferences) {
  try {
    window.localStorage.setItem(translationPreferencesKey, JSON.stringify(preferences));
  } catch {
    // Storage unavailable: the defaults only last for this session.
  }
}

export function useTranslationPreferences() {
  const [preferences, setPreferences] = useState(readTranslationPreferences);
  const update = useCallback((patch: Partial<TranslationPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeTranslationPreferences(next);
      return next;
    });
  }, []);
  return [preferences, update] as const;
}

/**
 * Mac integrations (Ajustes → Kindle / iCloud): the Kindle page's default send method
 * and the iCloud Drive folder that "Salvar no iCloud" copies EPUBs into.
 */
export type IntegrationPreferences = {
  kindleMethod: KindleSendMethod;
  icloudFolder: string;
};

export const integrationPreferencesKey = "oghma.integrations.v1";
export const DEFAULT_ICLOUD_FOLDER = "Livros";
export const SEND_TO_KINDLE_URL = "https://www.amazon.com/sendtokindle/mac";
const kindleMethods: KindleSendMethod[] = ["wireless", "usb"];

export const defaultIntegrationPreferences: IntegrationPreferences = { kindleMethod: "usb", icloudFolder: DEFAULT_ICLOUD_FOLDER };

/** Relative folder names only, matching the Rust check (no "..", no hidden parts). */
export function normalizeICloudFolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_ICLOUD_FOLDER;
  const parts = value.split("/").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part.startsWith("."))) return DEFAULT_ICLOUD_FOLDER;
  return parts.join("/");
}

export function readIntegrationPreferences(): IntegrationPreferences {
  try {
    const raw = window.localStorage.getItem(integrationPreferencesKey);
    if (!raw) return defaultIntegrationPreferences;
    const value = JSON.parse(raw) as Partial<Record<keyof IntegrationPreferences, unknown>>;
    return {
      kindleMethod: kindleMethods.includes(value.kindleMethod as KindleSendMethod)
        ? (value.kindleMethod as KindleSendMethod)
        : defaultIntegrationPreferences.kindleMethod,
      icloudFolder: normalizeICloudFolder(value.icloudFolder)
    };
  } catch {
    return defaultIntegrationPreferences;
  }
}

export function writeIntegrationPreferences(preferences: IntegrationPreferences) {
  try {
    window.localStorage.setItem(integrationPreferencesKey, JSON.stringify(preferences));
  } catch {
    // Storage unavailable: the choice only lasts for this session.
  }
}

export function useIntegrationPreferences() {
  const [preferences, setPreferences] = useState(readIntegrationPreferences);
  const update = useCallback((patch: Partial<IntegrationPreferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      writeIntegrationPreferences(next);
      return next;
    });
  }, []);
  return [preferences, update] as const;
}
