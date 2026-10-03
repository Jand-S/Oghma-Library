import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AppView } from "../../app/NavigationContext";
import { useNovelSearch } from "../../app/useNovelSearch";
import { defaultFilters, defaultSelection } from "../../core/defaults";
import type { AppConfig, ChapterSelection, EnqueueResult, Filters, LibraryItem, Novel, QueueItem, SourceSite, TagCatalogItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { readUiPreferences } from "../settings/preferences";
import type { SortDirection } from "./DiscoverHeader";

type DiscoverControllerArgs = {
  backend: BackendClient;
  view: AppView;
  appConfig: AppConfig;
  sources: SourceSite[];
  results: Novel[];
  setResults: Dispatch<SetStateAction<Novel[]>>;
  loading: boolean;
  bootError: string | null;
  focusedNovelId: string;
  setFocusedNovelId: (id: string) => void;
  /** Local library, to tell whether the selected book would replace an existing copy. */
  library: LibraryItem[];
  /** True when the novel is active or waiting in the download queue. */
  isQueued: (novelId: string) => boolean;
  /** Enqueues the shaped download and shows the added/duplicate/full feedback. */
  enqueueDownload: (item: QueueItem) => EnqueueResult;
  notify: (message: string) => void;
};

/**
 * State and handlers of the Discover view: search, filters and ONE selected book at a
 * time. The configurator applies to the selected book and "Baixar" enqueues it.
 */
export function useDiscoverController({
  backend,
  view,
  appConfig,
  sources,
  results,
  setResults,
  loading,
  bootError,
  focusedNovelId,
  setFocusedNovelId,
  library,
  isQueued,
  enqueueDownload,
  notify
}: DiscoverControllerArgs) {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  /** Title order of the result grid (client-side). */
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [tagCatalog, setTagCatalog] = useState<TagCatalogItem[]>([]);
  const [selectedNovel, setSelectedNovel] = useState<Novel | null>(null);
  const [previewNovel, setPreviewNovel] = useState<Novel | null>(null);
  const [selections, setSelections] = useState<Record<string, ChapterSelection>>({});
  const [adding, setAdding] = useState(false);

  // Remember whether the last search failed, so the view can show an "offline" state
  // instead of a misleading "no results".
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchBackend = useMemo<BackendClient>(() => ({
    ...backend,
    searchNovels: (next: Filters) =>
      backend.searchNovels(next).then(
        (items) => {
          setSearchError(null);
          return items;
        },
        (error: unknown) => {
          setSearchError(getErrorMessage(error, "Não foi possível atualizar os resultados da busca."));
          throw error;
        }
      )
  }), [backend]);

  // "Todas as fontes" searches only the enabled ones.
  const enabledKey = sources.filter((source) => source.enabled).map((source) => source.id).join(",");
  const searchFilters = useMemo<Filters>(
    () => ({ ...filters, sourceIds: enabledKey ? enabledKey.split(",") : [] }),
    [filters, enabledKey]
  );

  const searching = useNovelSearch({
    backend: searchBackend,
    filters: searchFilters,
    focusedNovelId,
    loading,
    setFocusedNovelId,
    setResults,
    setToast: notify
  });

  useEffect(() => {
    if (sources.length === 0) return;
    if (filters.sourceId === "all") return;
    // A source that was turned off falls back to "Todas as fontes".
    const selectedExists = sources.some((source) => source.enabled && source.id === filters.sourceId);
    if (!selectedExists) {
      setFilters((current) => ({ ...current, sourceId: "all", language: "all" }));
    }
  }, [filters.sourceId, sources]);

  useEffect(() => {
    if (loading || bootError || view !== "discover") return;
    let cancelled = false;
    void backend.getTags(filters.sourceId)
      .then((items) => {
        if (!cancelled) setTagCatalog(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTagCatalog([]);
          notify(getErrorMessage(error, "Não foi possível carregar as tags."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, backend, bootError, filters.sourceId, loading, notify]);

  const libraryNovelIds = useMemo(
    () => new Set(library.map((item) => item.novelId).filter((id): id is string => Boolean(id))),
    [library]
  );

  const detailNovel = previewNovel ?? selectedNovel ?? undefined;

  const buildDefaultSelection = (novel: Novel): ChapterSelection => ({
    ...defaultSelection(novel),
    preset: readUiPreferences().chapterPreset,
    formats: appConfig.defaultFormats,
    translate: false,
    audiobook: appConfig.audiobookDefault
  });

  const selection = selectedNovel ? selections[selectedNovel.id] ?? buildDefaultSelection(selectedNovel) : null;

  /** Selects a novel (single selection); selecting the selected novel again clears it. */
  const selectNovel = (novel: Novel) => {
    setPreviewNovel(null);
    if (selectedNovel?.id === novel.id) {
      setSelectedNovel(null);
      setFocusedNovelId("");
      return;
    }
    setSelectedNovel(novel);
    setSelections((current) => current[novel.id] ? current : { ...current, [novel.id]: buildDefaultSelection(novel) });
    setFocusedNovelId(novel.id);
  };

  const clearSelection = () => {
    setSelectedNovel(null);
    setFocusedNovelId(previewNovel?.id ?? "");
  };

  const openPreviewNovel = (novel: Novel) => {
    setPreviewNovel(novel);
    setFocusedNovelId(novel.id);
  };

  const clearPreviewNovel = () => {
    setPreviewNovel(null);
    setFocusedNovelId(selectedNovel?.id ?? "");
  };

  const addSelectedToQueue = () => {
    if (!selectedNovel || !selection || adding) return;
    setAdding(true);
    void backend.createDownloads([selection])
      .then(([item]) => {
        if (!item) return;
        const outcome = enqueueDownload(item);
        if (outcome.result === "added") {
          setPreviewNovel(null);
          setSelectedNovel(null);
          setFocusedNovelId("");
        }
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, "Não foi possível adicionar o livro à fila."));
      })
      .finally(() => setAdding(false));
  };

  const updateSelection = (next: ChapterSelection) =>
    setSelections((current) => ({ ...current, [next.novelId]: next }));

  /** Re-runs the current search (the search hook reacts to a new filters object). */
  const retrySearch = useCallback(() => setFilters((current) => ({ ...current })), []);

  return {
    results,
    filters,
    setFilters,
    sortDirection,
    setSortDirection,
    tagCatalog,
    searching,
    /** Message of the last failed search, or null once a search succeeds. */
    searchError,
    retrySearch,
    /** The one book the configurator applies to. */
    selectedNovel,
    /** Chapter/format configuration of the selected book. */
    selection,
    previewNovel,
    detailNovel,
    updateSelection,
    selectNovel,
    clearSelection,
    openPreviewNovel,
    clearPreviewNovel,
    addSelectedToQueue,
    /** True while the selected book is being shaped/enqueued. */
    adding,
    /** The selected book already has a copy in the local library ("Baixar novamente"). */
    selectedInLibrary: Boolean(selectedNovel && libraryNovelIds.has(selectedNovel.id)),
    /** The selected book is already active or waiting in the queue. */
    selectedQueued: Boolean(selectedNovel && isQueued(selectedNovel.id))
  };
}

export type DiscoverController = ReturnType<typeof useDiscoverController>;
