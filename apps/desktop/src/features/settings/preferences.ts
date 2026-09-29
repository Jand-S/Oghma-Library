import { useCallback, useState } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { ChapterPreset } from "../../core/types";

/**
 * UI preferences that are not part of `AppConfig` (which is shared with the backend
 * flows): start page and default chapter preset. Stored under their own key so the
 * config schema stays unchanged.
 */
export type StartPage = Extract<AppView, "discover" | "library" | "downloads" | "kindle">;

export type UiPreferences = {
  startPage: StartPage;
  chapterPreset: ChapterPreset;
};

export const uiPreferencesKey = "oghma.prefs.v1";
export const startPages: StartPage[] = ["discover", "library", "downloads", "kindle"];
const chapterPresets: ChapterPreset[] = ["all", "range"];

export const defaultUiPreferences: UiPreferences = { startPage: "discover", chapterPreset: "all" };

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
