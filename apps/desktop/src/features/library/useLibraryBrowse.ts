import { useCallback, useMemo, useState } from "react";
import type { DownloadFormat, LibraryItem } from "../../core/types";
import { availableFormats, filterLibrary, type LibrarySort, type LibraryViewMode } from "./libraryModel";

const VIEW_KEY = "oghma.library.view";
const SORT_KEY = "oghma.library.sort";

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
  const [sort, setSortState] = useState<LibrarySort>(() => readPref(SORT_KEY, ["recent", "title", "size"], "recent"));
  const [view, setViewState] = useState<LibraryViewMode>(() => readPref(VIEW_KEY, ["grid", "list"], "grid"));

  const formats = useMemo(() => availableFormats(library), [library]);
  const filtered = useMemo(
    () => filterLibrary(library, { query, formats: selectedFormats, favoritesOnly, sort }),
    [favoritesOnly, library, query, selectedFormats, sort]
  );

  const setSort = useCallback((value: LibrarySort) => {
    setSortState(value);
    writePref(SORT_KEY, value);
  }, []);

  const setView = useCallback((value: LibraryViewMode) => {
    setViewState(value);
    writePref(VIEW_KEY, value);
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

  const clearFilters = useCallback(() => {
    setQuery("");
    setSelectedFormats(new Set());
    setFavoritesOnly(false);
  }, []);

  return {
    query,
    setQuery,
    formats,
    selectedFormats,
    toggleFormat,
    favoritesOnly,
    toggleFavorites,
    sort,
    setSort,
    view,
    setView,
    /** Library after search, chips and sort. */
    filtered,
    clearFilters
  };
}

export type LibraryBrowse = ReturnType<typeof useLibraryBrowse>;
