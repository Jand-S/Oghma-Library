import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LibraryItem, Novel } from "../core/types";
import { contentRatingForNovel } from "../core/tagFilters";
import { CoverPrivacyContext, type CoverPrivacy } from "../ui";
import { catalogNovelById } from "./useLocalLibrary";

/**
 * +18 covers: covered by default (the catalog tags say "erotic"), with per-book choices of the
 * reader ("Ocultar esta capa" / "Sempre mostrar esta capa"). A cover shown with the eye stays
 * visible until the app closes. Stored on this computer.
 */
export type CoverSettings = {
  hideAdult: boolean;
  /** Novel id (catalog's current one) → the reader's choice for that cover. */
  overrides: Record<string, "show" | "hide">;
};

export const coverSettingsKey = "oghma.covers.v1";
const defaultCoverSettings: CoverSettings = { hideAdult: true, overrides: {} };

function readCoverSettings(): CoverSettings {
  try {
    const raw = window.localStorage.getItem(coverSettingsKey);
    if (!raw) return defaultCoverSettings;
    const value = JSON.parse(raw) as Partial<CoverSettings>;
    const overrides = Object.fromEntries(
      Object.entries(value.overrides ?? {}).filter(([, choice]) => choice === "show" || choice === "hide")
    ) as CoverSettings["overrides"];
    return { hideAdult: value.hideAdult !== false, overrides };
  } catch {
    return defaultCoverSettings;
  }
}

// One store for the whole app: Ajustes and the covers see the same value at once.
let current: CoverSettings | null = null;
const listeners = new Set<() => void>();

function snapshot(): CoverSettings {
  current ??= readCoverSettings();
  return current;
}

export function updateCoverSettings(patch: (settings: CoverSettings) => CoverSettings) {
  current = patch(snapshot());
  try {
    window.localStorage.setItem(coverSettingsKey, JSON.stringify(current));
  } catch {
    // Storage unavailable: the choice only lasts for this session.
  }
  for (const listener of listeners) listener();
}

/** Test helper: forget the cached settings (storage is read again). */
export function resetCoverSettingsCache() {
  current = null;
}

export function useCoverSettings(): CoverSettings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot
  );
}

/** Whether a novel's cover is covered by the rules (before the eye shows it). */
export function coverHidden(novelId: string | undefined, novel: Novel | undefined, settings: CoverSettings): boolean {
  const choice = novelId ? settings.overrides[novel?.id ?? novelId] : undefined;
  if (choice) return choice === "hide";
  return settings.hideAdult && Boolean(novel) && contentRatingForNovel(novel!) === "erotic";
}

/** Image URLs to cover: catalog novels and library books (whose cover may be a local file). */
export function concealedCoverUrls(catalog: Novel[], library: LibraryItem[], settings: CoverSettings): Set<string> {
  const urls = new Set<string>();
  for (const novel of catalog) {
    if (novel.coverUrl && coverHidden(novel.id, novel, settings)) urls.add(novel.coverUrl);
  }
  for (const item of library) {
    if (!item.coverUrl || !item.novelId) continue;
    if (coverHidden(item.novelId, catalogNovelById(catalog, item.novelId), settings)) urls.add(item.coverUrl);
  }
  return urls;
}

type CoverControls = {
  /** Covered by the rules (ignores a cover shown with the eye this session). */
  isHidden: (novelId: string) => boolean;
  /** Flips a book between covered and shown, as a lasting choice. */
  toggle: (novelId: string) => void;
};

const CoverControlsContext = createContext<CoverControls>({ isHidden: () => false, toggle: () => undefined });

export function useCoverControls(): CoverControls {
  return useContext(CoverControlsContext);
}

export function CoverPrivacyProvider({ catalog, library, children }: { catalog: Novel[]; library: LibraryItem[]; children: ReactNode }) {
  const settings = useCoverSettings();
  const concealed = useMemo(() => concealedCoverUrls(catalog, library, settings), [catalog, library, settings]);
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set());

  const privacy = useMemo<CoverPrivacy>(() => ({
    isConcealed: (src) => concealed.has(src) && !revealed.has(src),
    reveal: (src) => setRevealed((shown) => new Set(shown).add(src))
  }), [concealed, revealed]);

  const isHidden = useCallback(
    (novelId: string) => coverHidden(novelId, catalogNovelById(catalog, novelId), settings),
    [catalog, settings]
  );
  const toggle = useCallback((novelId: string) => {
    const novel = catalogNovelById(catalog, novelId);
    const id = novel?.id ?? novelId;
    const hide = !coverHidden(id, novel, settings);
    const byDefault = coverHidden(id, novel, { ...settings, overrides: {} });
    updateCoverSettings((state) => {
      const overrides = { ...state.overrides };
      if (hide === byDefault) delete overrides[id];
      else overrides[id] = hide ? "hide" : "show";
      return { ...state, overrides };
    });
    // A cover covered again must not stay shown by an earlier click on the eye.
    if (hide) {
      const urls = [novel?.coverUrl, ...library.filter((item) => item.novelId === novelId || item.novelId === id).map((item) => item.coverUrl)];
      setRevealed((shown) => new Set([...shown].filter((src) => !urls.includes(src))));
    }
  }, [catalog, library, settings]);
  const controls = useMemo(() => ({ isHidden, toggle }), [isHidden, toggle]);

  return (
    <CoverControlsContext.Provider value={controls}>
      <CoverPrivacyContext.Provider value={privacy}>{children}</CoverPrivacyContext.Provider>
    </CoverControlsContext.Provider>
  );
}
