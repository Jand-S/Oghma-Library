import { useCallback, useEffect, useMemo, useState } from "react";
import type { DownloadFormat, LibraryItem } from "../../core/types";
import { availableFormats, filterLibrary, statusCounts, type LibrarySort, type LibraryStatusFilter, type LibraryViewMode, isTranslated } from "./libraryModel";

const VIEW_KEY = "oghma.library.view";
const SORT_KEY = "oghma.library.sort";
const STACKS_KEY = "oghma.library.stacks";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the preference is just not remembered.
  }
}

/**
 * Browse state of the Library page (search, format chips, favorites, sort, grid/list).
 * It lives in the controller so the PageHeader (search, count, view toggle) and the
 * page body share it. Sort and view mode are remembered across sessions.
 */
export function useLibraryBrowse(library: LibraryItem[]) {
  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<ReadonlySet<DownloadFormat>>(() => new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [status, setStatusState] = useState<LibraryStatusFilter>("all");
  const [translatedOnly, setTranslatedOnly] = useState(false);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [sort, setSortState] = useState<LibrarySort>(() => readPref(SORT_KEY, ["recent", "title", "size", "rating"], "recent"));
  const [view, setViewState] = useState<LibraryViewMode>(() => readPref(VIEW_KEY, ["grid", "list"], "grid"));
  // Editions of the same work as one card (grid only); on unless turned off.
  const [stacks, setStacksState] = useState(() => readPref(STACKS_KEY, ["on", "off"], "on") === "on");

  const formats = useMemo(() => availableFormats(library), [library]);
  const filtered = useMemo(
    () => filterLibrary(library, { query, formats: selectedFormats, favoritesOnly, status, translatedOnly, hiddenOnly, sort }),
    [favoritesOnly, hiddenOnly, library, query, selectedFormats, sort, status, translatedOnly]
  );
  const counts = useMemo(() => statusCounts(library), [library]);
  /** Picking the selected status again goes back to every book. */
  const setStatus = useCallback((value: LibraryStatusFilter) => setStatusState((current) => (current === value ? "all" : value)), []);

  const setSort = useCallback((value: LibrarySort) => {
    setSortState(value);
    writePref(SORT_KEY, value);
  }, []);

  const setView = useCallback((value: LibraryViewMode) => {
    setViewState(value);
    writePref(VIEW_KEY, value);
  }, []);

  const toggleStacks = useCallback(() => {
    setStacksState((current) => {
      writePref(STACKS_KEY, current ? "off" : "on");
      return !current;
    });
  }, []);

  const toggleFormat = useCallback((format: DownloadFormat) => {
    setSelectedFormats((current) => {
      const next = new Set(current);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });
  }, []);

  const toggleFavorites = useCallback(() => setFavoritesOnly((value) => !value), []);
  const toggleTranslated = useCallback(() => setTranslatedOnly((value) => !value), []);
  const hasTranslated = useMemo(() => library.some(isTranslated), [library]);
  const toggleHidden = useCallback(() => setHiddenOnly((value) => !value), []);
  /** Opens the "Ocultos" view (books removed from the library whose files are still here). */
  const showHidden = useCallback(() => {
    setStatusState("all");
    setHiddenOnly(true);
  }, []);
  const hiddenCount = useMemo(() => library.filter((item) => item.hidden).length, [library]);
  // Last hidden book brought back: leave the (now empty) "Ocultos" view.
  useEffect(() => {
    if (hiddenOnly && hiddenCount === 0) setHiddenOnly(false);
  }, [hiddenCount, hiddenOnly]);

  const clearFilters = useCallback(() => {
    setQuery("");
    setSelectedFormats(new Set());
    setFavoritesOnly(false);
    setStatusState("all");
    setTranslatedOnly(false);
    setHiddenOnly(false);
  }, []);

  return {
    query,
    setQuery,
    formats,
    selectedFormats,
    toggleFormat,
    favoritesOnly,
    toggleFavorites,
    status,
    setStatus,
    /** Books per status chip (hidden books left out). */
    statusCounts: counts,
    translatedOnly,
    toggleTranslated,
    hasTranslated,
    hiddenOnly,
    toggleHidden,
    showHidden,
    hiddenCount,
    sort,
    setSort,
    view,
    setView,
    stacks,
    toggleStacks,
    /** Library after search, chips and sort. */
    filtered,
    clearFilters
  };
}

export type LibraryBrowse = ReturnType<typeof useLibraryBrowse>;
