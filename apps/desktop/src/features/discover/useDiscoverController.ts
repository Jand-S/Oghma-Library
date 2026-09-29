import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { AppView } from "../../app/NavigationContext";
import { useNovelSearch } from "../../app/useNovelSearch";
import { defaultFilters, defaultSelection } from "../../core/defaults";
import type { AppConfig, ChapterSelection, Filters, Novel, QueueItem, SourceSite, TagCatalogItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";

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
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  notify: (message: string) => void;
  /** Called after novels were added to the download queue (flashes the Downloads nav entry). */
  onQueued: () => void;
};

/** State and handlers of the Discover view (search, filters, selection, queueing). Moved from App.tsx unchanged. */
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
  setQueue,
  notify,
  onQueued
}: DiscoverControllerArgs) {
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [tagCatalog, setTagCatalog] = useState<TagCatalogItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedNovelById, setSelectedNovelById] = useState<Record<string, Novel>>({});
  const [previewNovel, setPreviewNovel] = useState<Novel | null>(null);
  const [selections, setSelections] = useState<Record<string, ChapterSelection>>({});

  const searching = useNovelSearch({
    backend,
    filters,
    focusedNovelId,
    loading,
    setFocusedNovelId,
    setResults,
    setToast: notify
  });

  useEffect(() => {
    if (sources.length === 0) return;
    const available = sources.filter((source) => source.enabled);
    const fallback = available[0] ?? sources[0];
    const selectedExists = available.some((source) => source.id === filters.sourceId);
    if (!selectedExists && fallback) {
      setFilters((current) => ({ ...current, sourceId: fallback.id, language: "all" }));
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
          notify(getErrorMessage(error, "Nao foi possivel carregar as tags."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, backend, bootError, filters.sourceId, loading, notify]);

  const selectedNovels = useMemo(
    () => selectedIds.map((id) => selectedNovelById[id]).filter((novel): novel is Novel => Boolean(novel)),
    [selectedIds, selectedNovelById]
  );
  const selectedDetailNovel = selectedNovels[selectedNovels.length - 1];
  const detailNovel = previewNovel ?? selectedDetailNovel;

  const buildDefaultSelection = (novel: Novel) => ({
    ...defaultSelection(novel),
    formats: appConfig.defaultFormats,
    translate: false,
    audiobook: appConfig.audiobookDefault
  });

  const rememberNovelSelection = (novel: Novel) => {
    setSelectedNovelById((current) => {
      if (current[novel.id] === novel) return current;
      return { ...current, [novel.id]: novel };
    });
    setSelections((current) => current[novel.id] ? current : { ...current, [novel.id]: buildDefaultSelection(novel) });
  };

  const toggleNovel = (novel: Novel) => {
    const removing = selectedIds.includes(novel.id);
    const nextIds = removing
      ? selectedIds.filter((id) => id !== novel.id)
      : [...selectedIds, novel.id];
    setSelectedIds(nextIds);
    if (removing) {
      setSelectedNovelById((current) => {
        const next = { ...current };
        delete next[novel.id];
        return next;
      });
      setFocusedNovelId(nextIds[nextIds.length - 1] ?? "");
      return;
    }
    rememberNovelSelection(novel);
    setFocusedNovelId(novel.id);
  };

  const selectNovel = (novel: Novel) => {
    setPreviewNovel(null);
    toggleNovel(novel);
  };

  const removeSelectedNovel = (novelId: string) => {
    const nextIds = selectedIds.filter((id) => id !== novelId);
    setSelectedIds(nextIds);
    setSelectedNovelById((current) => {
      const next = { ...current };
      delete next[novelId];
      return next;
    });
    setFocusedNovelId(nextIds[nextIds.length - 1] ?? "");
  };

  const openPreviewNovel = (novel: Novel) => {
    setPreviewNovel(novel);
    setFocusedNovelId(novel.id);
  };

  const clearPreviewNovel = () => {
    setPreviewNovel(null);
    setFocusedNovelId(selectedIds[selectedIds.length - 1] ?? "");
  };

  const addSelectedToQueue = () => {
    const payload = selectedNovels.map((novel) => selections[novel.id] ?? buildDefaultSelection(novel));
    if (payload.length === 0) return;
    void backend.createDownloads(payload)
      .then((items) => {
        setPreviewNovel(null);
        setQueue((current) => [...current, ...items]);
        setSelectedIds([]);
        setSelectedNovelById({});
        setFocusedNovelId("");
        onQueued();
        notify(`${items.length} pacote(s) adicionados a fila de download.`);
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, "Nao foi possivel adicionar os itens a fila."));
      });
  };

  const updateSelection = (selection: ChapterSelection) =>
    setSelections((current) => ({ ...current, [selection.novelId]: selection }));

  const workspaceClassName = `workspace discover ${!filtersCollapsed ? "filters-open" : ""} ${selectedIds.length > 0 || previewNovel ? "selection-open" : ""}`;

  return {
    results,
    filters,
    setFilters,
    filtersCollapsed,
    toggleFilters: () => setFiltersCollapsed((value) => !value),
    tagCatalog,
    searching,
    selectedIds,
    setSelectedIds,
    selectedNovels,
    previewNovel,
    detailNovel,
    selections,
    updateSelection,
    toggleNovel,
    selectNovel,
    removeSelectedNovel,
    openPreviewNovel,
    clearPreviewNovel,
    addSelectedToQueue,
    workspaceClassName
  };
}

export type DiscoverController = ReturnType<typeof useDiscoverController>;
