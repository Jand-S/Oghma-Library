import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ToastTone } from "../../ui";
import type { AppView } from "../../app/NavigationContext";
import { useNovelSearch } from "../../app/useNovelSearch";
import { defaultFilters, defaultSelection } from "../../core/defaults";
import type { AppConfig, ChapterSelection, EnqueueResult, Filters, LibraryItem, Novel, QueueItem, SourceSite, TagCatalogItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { editionsOf, similarNovels, type CatalogIndex } from "../../services/catalogIndex";
import { chatGptAsker, runSmartFilter, type SmartResult } from "../../services/smartFilter";
import type { SmartStageInfo } from "./SmartFilterStatus";
import { discoverStrings } from "../../strings/discover";
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
  notify: (message: string, tone?: ToastTone) => void;
  /** ChatGPT account connected (the app-wide account, see controllers.account). */
  aiAvailable: boolean;
};

/**
 * State and handlers of the Discover view: search, filters and ONE selected book at a
 * time. The configurator applies to the selected book and "Baixar" enqueues it.
 */
const STACKS_KEY = "oghma.discover.stacks";

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
  notify,
  aiAvailable
}: DiscoverControllerArgs) {
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  /** Title order of the result grid (client-side). */
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  // The same work from several sources as one card; on unless turned off (remembered).
  const [stacks, setStacksState] = useState(() => {
    try {
      return window.localStorage.getItem(STACKS_KEY) !== "off";
    } catch {
      return true;
    }
  });
  const toggleStacks = useCallback(() => {
    setStacksState((current) => {
      try {
        window.localStorage.setItem(STACKS_KEY, current ? "off" : "on");
      } catch {
        // Storage unavailable: the choice lasts for this session.
      }
      return !current;
    });
  }, []);
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
          notify(getErrorMessage(error, "Não foi possível carregar as tags."), "danger");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [view, backend, bootError, filters.sourceId, loading, notify]);

  const libraryNovelIds = useMemo(
    // Downloaded copies only: a book on the shelf (no files) is downloaded, not "downloaded again".
    () => new Set(library.filter((item) => item.availability !== "shelf").map((item) => item.novelId).filter((id): id is string => Boolean(id))),
    [library]
  );

  const detailNovel = previewNovel ?? selectedNovel ?? undefined;

  // "Filtro inteligente": the request becomes the normal filters plus an order by similarity.
  const [smart, setSmart] = useState<SmartResult | null>(null);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartStage, setSmartStage] = useState<SmartStageInfo | null>(null);
  // A request typed while logged out runs as soon as the ChatGPT login completes.
  const [pendingSmart, setPendingSmart] = useState<string | null>(null);

  // Catalog index for "Também em" (same work in other sources) and "Parecidos".
  const [catalogIndex, setCatalogIndex] = useState<CatalogIndex | null>(null);
  useEffect(() => {
    if (loading || bootError || !backend.getCatalogIndex) return;
    let cancelled = false;
    void backend.getCatalogIndex().then((index) => {
      if (!cancelled) setCatalogIndex(index);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [backend, bootError, loading, sources]);
  const related = useMemo(() => {
    if (!detailNovel || !catalogIndex) return { editions: [] as Novel[], similar: [] as Novel[] };
    const enabled = sources.filter((source) => source.enabled).map((source) => source.id);
    return {
      editions: editionsOf(catalogIndex, detailNovel).filter((novel) => enabled.includes(novel.sourceId)),
      similar: similarNovels(catalogIndex, [detailNovel], { limit: 6, sourceIds: enabled })
    };
  }, [catalogIndex, detailNovel, sources]);

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
        notify(getErrorMessage(error, "Não foi possível adicionar o livro à fila."), "danger");
      })
      .finally(() => setAdding(false));
  };

  const askSmart = (request: string) => {
    if (smartBusy) return;
    setSmartBusy(true);
    void (async () => {
      try {
        const index = catalogIndex ?? (backend.getCatalogIndex ? await backend.getCatalogIndex() : null);
        if (!index) return;
        const tags = await backend.getTags("all");
        const result = await runSmartFilter(request, {
          index,
          tags,
          ask: aiAvailable ? chatGptAsker() : null,
          onStage: (stage, candidates) => setSmartStage({ stage, candidates })
        });
        setSmart({ ...result, request });
        setFilters({ ...result.filters, sourceId: "all" });
        if (result.fallbackReason && result.fallbackReason !== "not_logged_in") {
          notify(discoverStrings.smartFallback, "info");
        }
      } catch (error: unknown) {
        notify(getErrorMessage(error, discoverStrings.smartFailed), "danger");
      } finally {
        setSmartBusy(false);
        setSmartStage(null);
      }
    })();
  };

  useEffect(() => {
    if (!aiAvailable || !pendingSmart) return;
    setPendingSmart(null);
    askSmart(pendingSmart);
    // askSmart reads the latest state; only the login and the pending request matter here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiAvailable, pendingSmart]);

  const clearSmart = () => {
    setSmart(null);
    setFilters(defaultFilters("all"));
  };

  const updateSelection = (next: ChapterSelection) =>
    setSelections((current) => ({ ...current, [next.novelId]: next }));

  /** Re-runs the current search (the search hook reacts to a new filters object). */
  const retrySearch = useCallback(() => setFilters((current) => ({ ...current })), []);

  return {
    results,
    smart,
    smartBusy,
    smartStage,
    aiAvailable,
    askSmart,
    /** Keeps a request to run once the ChatGPT login completes (null cancels). */
    askSmartAfterLogin: setPendingSmart,
    pendingSmart,
    clearSmart,
    /** Other editions and similar novels of the novel in the details panel. */
    related,
    /** Catalog index (Início uses it for suggestions); null until loaded. */
    catalogIndex,
    filters,
    setFilters,
    sortDirection,
    setSortDirection,
    stacks,
    toggleStacks,
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
