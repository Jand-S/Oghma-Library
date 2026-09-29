import { CloudOff, RefreshCcw, Settings } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState
} from "react";
import { useBootstrapState } from "./app/useBootstrapState";
import { useConversionManager } from "./app/useConversionManager";
import { useDownloadProcessor } from "./app/useDownloadProcessor";
import { useKindleDetection } from "./app/useKindleDetection";
import { useLocalLibrary } from "./app/useLocalLibrary";
import { useNovelSearch } from "./app/useNovelSearch";
import { useOnboardingSync } from "./app/useOnboardingSync";
import { useToast } from "./app/useToast";
import {
  DiscoverView,
  DownloadsView,
  LibraryView,
  onboardingSteps,
  OnboardingWizard,
  pageTitle,
  SettingsView,
  Sidebar,
  SourcesView,
  SplashScreen,
  Titlebar,
  TranslationView
} from "./appUi";
import {
  hasCompletedSetup,
  markSetupComplete,
} from "./core/appConfig";
import { defaultFilters, defaultSelection } from "./core/defaults";
import type {
  AppConfig,
  ChapterSelection,
  Filters,
  LibraryItem,
  Novel,
  QueueItem,
  ServerProbe,
  TagCatalogItem,
  LibraryMeta,
} from "./core/types";
import { getErrorMessage, type BackendClient } from "./services/backendClient";
import { sanitizeFileName } from "./services/downloadManager";
import {
  deleteLibraryMetadata,
  deleteLocalLibraryFiles,
  joinPath,
  openLocalPath,
  saveLibraryMetadata
} from "./services/localFiles";
import { kindleStrings } from "./strings/common";

type AppProps = {
  backend: BackendClient;
};

function libraryToQueueItems(items: LibraryItem[]): QueueItem[] {
  return items.map((item) => ({
    id: item.id,
    novelId: item.novelId ?? item.id,
    title: item.title,
    coverClass: item.coverClass,
    coverUrl: item.coverUrl,
    bundleKey: item.bundleKey,
    preset: "all",
    rangeLabel: item.chapters ? `Todos os ${item.chapters.toLocaleString("pt-BR")} capitulos` : "Livro local",
    progress: 100,
    state: "done",
    chaptersTotal: item.chapters || 0,
    formats: item.formats?.length ? item.formats : [item.format],
    translate: false,
    audiobook: false,
    outputDir: item.outputDir,
    outputFiles: item.files
  }));
}

export function App({ backend }: AppProps) {
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [tagCatalog, setTagCatalog] = useState<TagCatalogItem[]>([]);
  const [serverProbe, setServerProbe] = useState<ServerProbe | null>(null);
  const [probingServer, setProbingServer] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedNovelById, setSelectedNovelById] = useState<Record<string, Novel>>({});
  const [previewNovel, setPreviewNovel] = useState<Novel | null>(null);
  const [downloadsPulse, setDownloadsPulse] = useState(0);
  const [selections, setSelections] = useState<Record<string, ChapterSelection>>({});
  const [syncing, setSyncing] = useState<string[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const { toast, setToast } = useToast();
  const { kindleStatus, setKindleStatus } = useKindleDetection(false);
  const {
    activeView,
    appConfig,
    autoSelectedRef,
    bootDone,
    bootError,
    focusedNovelId,
    library,
    loading,
    queue,
    results,
    setActiveView,
    setAppConfig,
    setFocusedNovelId,
    setLibrary,
    setQueue,
    setResults,
    setShowOnboarding,
    setSources,
    showOnboarding,
    showSplash,
    sources
  } = useBootstrapState({ backend, setKindleStatus });
  const searching = useNovelSearch({
    backend,
    filters,
    focusedNovelId,
    loading,
    setFocusedNovelId,
    setResults,
    setToast
  });
  const { refreshLocalLibrary, saveCoverForItem } = useLocalLibrary({ appConfig, loading, results, setLibrary });
  const {
    setupSync,
    setupSyncRunning,
    setupSyncCompleted,
    setSetupSync,
    setSetupSyncRunning,
    setSetupSyncCompleted
  } = useOnboardingSync({ showOnboarding, onboardingStep, appConfig, backend, setSources, setSyncing, setToast });

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
    if (loading || bootError || activeView !== "discover") return;
    let cancelled = false;
    void backend.getTags(filters.sourceId)
      .then((items) => {
        if (!cancelled) setTagCatalog(items);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setTagCatalog([]);
          setToast(getErrorMessage(error, "Nao foi possivel carregar as tags."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activeView, backend, bootError, filters.sourceId, loading, setToast]);

  const kindleConnected = kindleStatus?.connected ?? false;
  useDownloadProcessor({
    appConfig,
    autoSelectedRef,
    queue,
    queuePaused,
    refreshLocalLibrary,
    results,
    saveCoverForItem,
    setQueue,
    setToast
  });

  const selectedNovels = useMemo(
    () => selectedIds.map((id) => selectedNovelById[id]).filter((novel): novel is Novel => Boolean(novel)),
    [selectedIds, selectedNovelById]
  );
  const selectedDetailNovel = selectedNovels[selectedNovels.length - 1];
  const detailNovel = previewNovel ?? selectedDetailNovel;
  const selectedCompletedItems = useMemo(
    () => selectedLibraryIds
      .map((id) => library.find((item) => item.id === id))
      .filter((item): item is LibraryItem => Boolean(item))
      .map((item) => libraryToQueueItems([item])[0]),
    [library, selectedLibraryIds]
  );
  const {
    converterAudiobook,
    converterCurrentItemId,
    converterFormats,
    converterProgress,
    converterRunning,
    startConversion,
    toggleConverterAudiobook,
    toggleConverterFormat,
  } = useConversionManager({ appConfig, kindleConnected, refreshLocalLibrary, selectedCompletedItems, setQueue, setToast });
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

  const selectNovel = (novel: Novel) => {
    setPreviewNovel(null);
    toggleNovel(novel);
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
        setDownloadsPulse((value) => value + 1);
        setToast(`${items.length} pacote(s) adicionados a fila de download.`);
      })
      .catch((error: unknown) => {
        setToast(getErrorMessage(error, "Nao foi possivel adicionar os itens a fila."));
      });
  };

  const patchConfig = (patch: Partial<AppConfig>) => {
    setAppConfig((current) => ({ ...current, ...patch }));
    if (Object.prototype.hasOwnProperty.call(patch, "serverUrl") || Object.prototype.hasOwnProperty.call(patch, "indexMode")) {
      setServerProbe(null);
    }
  };

  const clearSelectedQueue = () => {
    const doneCount = queue.filter((item) => item.state === "done").length;
    if (doneCount === 0) return;
    setQueue((current) => current.filter((item) => item.state !== "done"));
    setToast(`${doneCount} item(ns) concluido(s) removido(s) da fila.`);
  };

  const cancelDownload = (id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id));
    setToast("Download cancelado.");
  };

  const openFolder = (path: string, label = "pasta de saida") => {
    void openLocalPath(path)
      .then((opened) => {
        setToast(opened ? `Abrindo ${label}.` : `No navegador, use a pasta configurada: ${path}`);
      })
      .catch((error: unknown) => {
        setToast(getErrorMessage(error, `Nao foi possivel abrir ${label}.`));
      });
  };

  const openQueueItemFolder = (item: QueueItem) => openFolder(item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title)), `pasta de ${item.title}`);
  const openLibraryItemFolder = (item: LibraryItem) => openFolder(item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title)), `pasta de ${item.title}`);
  const libraryMetaKey = (item: LibraryItem) => item.outputDir ?? item.id;
  const metadataFromItem = (item: LibraryItem): LibraryMeta => ({
    key: libraryMetaKey(item),
    favorite: Boolean(item.favorite),
    readingStatus: item.readingStatus ?? "unread",
    tags: item.personalTags ?? [],
    hidden: Boolean(item.hidden)
  });
  const updateLibraryMeta = (item: LibraryItem, patch: Partial<Omit<LibraryMeta, "key">>) => {
    const nextMeta = { ...metadataFromItem(item), ...patch };
    setLibrary((items) => items.map((entry) => {
      if (libraryMetaKey(entry) !== nextMeta.key) return entry;
      return {
        ...entry,
        favorite: nextMeta.favorite,
        readingStatus: nextMeta.readingStatus,
        personalTags: nextMeta.tags,
        hidden: nextMeta.hidden
      };
    }).filter((entry) => !entry.hidden));
    if (nextMeta.hidden) {
      setSelectedLibraryIds((ids) => ids.filter((id) => id !== item.id));
    }
    void saveLibraryMetadata(nextMeta).catch((error: unknown) => {
      setToast(getErrorMessage(error, "Nao foi possivel salvar os metadados da biblioteca."));
    });
  };
  const deleteLibraryItems = (items: LibraryItem[], deleteFiles: boolean) => {
    if (items.length === 0) return;
    const keys = new Set(items.map(libraryMetaKey));
    const ids = new Set(items.map((item) => item.id));
    if (!deleteFiles) {
      const hiddenRows = items.map((item) => ({ ...metadataFromItem(item), hidden: true }));
      setLibrary((current) => current.filter((entry) => !keys.has(libraryMetaKey(entry))));
      setSelectedLibraryIds((current) => current.filter((id) => !ids.has(id)));
      void Promise.all(hiddenRows.map((meta) => saveLibraryMetadata(meta))).catch((error: unknown) => {
        setToast(getErrorMessage(error, "Nao foi possivel salvar os metadados da biblioteca."));
      });
      setToast(`${items.length} livro(s) removido(s) da biblioteca. Os arquivos foram mantidos.`);
      return;
    }
    const deletable = items.filter((item) => Boolean(item.outputDir));
    if (deletable.length === 0) {
      setToast("Nao foi possivel localizar a pasta dos livros selecionados.");
      return;
    }
    void Promise.allSettled(deletable.map((item) => deleteLocalLibraryFiles(appConfig.outputPath, item.outputDir ?? "")))
      .then((results) => {
        const deletedItems = deletable.filter((_, index) => {
          const result = results[index];
          return result.status === "fulfilled" && result.value === true;
        });
        if (deletedItems.length === 0) {
          setToast("Exclusao de arquivos so esta disponivel no app desktop.");
          return;
        }
        const deletedKeys = new Set(deletedItems.map(libraryMetaKey));
        const deletedIds = new Set(deletedItems.map((item) => item.id));
        setLibrary((current) => current.filter((entry) => !deletedKeys.has(libraryMetaKey(entry))));
        setSelectedLibraryIds((current) => current.filter((id) => !deletedIds.has(id)));
        void Promise.all(deletedItems.map((item) => deleteLibraryMetadata(libraryMetaKey(item)))).catch(() => undefined);
        const failedCount = items.length - deletedItems.length;
        setToast(failedCount > 0
          ? `${deletedItems.length} livro(s) excluido(s); ${failedCount} nao puderam ser removidos.`
          : `${deletedItems.length} livro(s) e arquivos locais excluidos.`);
        refreshLocalLibrary();
      })
      .catch((error: unknown) => {
        setToast(getErrorMessage(error, "Nao foi possivel excluir os arquivos locais."));
      });
  };
  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? ids.filter((itemId) => itemId !== id) : [...ids, id]));
  const removeSelectedLibraryItem = (id: string) =>
    setSelectedLibraryIds((ids) => ids.filter((itemId) => itemId !== id));

  const runSourceSync = async (sourceId: string, options?: { silentError?: boolean }) => {
    if (syncing.includes(sourceId)) return;
    setSyncing((items) => items.includes(sourceId) ? items : [...items, sourceId]);
    try {
      const updated = await backend.syncSource(sourceId);
      setSources((items) => items.map((source) => source.id === sourceId ? { ...updated, enabled: source.enabled } : source));
      return updated;
    } catch (error: unknown) {
      if (!options?.silentError) {
        setToast(getErrorMessage(error, "Nao foi possivel sincronizar a fonte."));
      }
      throw error;
    } finally {
      setSyncing((items) => items.filter((id) => id !== sourceId));
    }
  };

  const syncSource = (sourceId: string) => {
    void runSourceSync(sourceId).catch(() => undefined);
  };

  const toggleSourceEnabled = (sourceId: string) => {
    setSources((items) => items.map((source) => source.id === sourceId ? { ...source, enabled: !source.enabled } : source));
    setAppConfig((current) => {
      const enabledSourceIds = current.enabledSourceIds.includes(sourceId)
        ? current.enabledSourceIds.filter((id) => id !== sourceId)
        : [...current.enabledSourceIds, sourceId];
      return { ...current, enabledSourceIds };
    });
  };

  const toggleOnboardingSource = (sourceId: string) => {
    setAppConfig((current) => {
      const enabledSourceIds = current.enabledSourceIds.includes(sourceId)
        ? current.enabledSourceIds.filter((id) => id !== sourceId)
        : [...current.enabledSourceIds, sourceId];
      return { ...current, enabledSourceIds };
    });
  };

  const validateServer = () => {
    if (probingServer || appConfig.serverUrl.trim().length === 0) return;
    setProbingServer(true);
    void backend.validateServer(appConfig.serverUrl, appConfig.indexMode)
      .then((probe) => {
        setServerProbe(probe);
      })
      .catch((error: unknown) => {
        setServerProbe(null);
        setToast(getErrorMessage(error, "Nao foi possivel validar o servidor informado."));
      })
      .finally(() => {
        setProbingServer(false);
      });
  };

  const openOnboarding = () => {
    setOnboardingStep(0);
    setSetupSync({});
    setSetupSyncRunning(false);
    setSetupSyncCompleted(false);
    setShowOnboarding(true);
  };

  const closeOnboarding = () => {
    if (!hasCompletedSetup()) return;
    setSetupSync({});
    setSetupSyncRunning(false);
    setSetupSyncCompleted(false);
    setShowOnboarding(false);
  };

  const completeOnboarding = () => {
    markSetupComplete();
    setSources((items) => items.map((source) => ({ ...source, enabled: appConfig.enabledSourceIds.includes(source.id) })));
    setShowOnboarding(false);
    setOnboardingStep(0);
    setSetupSync({});
    setSetupSyncRunning(false);
    setSetupSyncCompleted(false);
    setToast("Configuracao inicial salva.");
  };

  const advanceOnboarding = () => {
    if (onboardingStep === onboardingSteps.length - 1) {
      completeOnboarding();
      return;
    }
    setOnboardingStep((value) => Math.min(value + 1, onboardingSteps.length - 1));
  };

  const rewindOnboarding = () => setOnboardingStep((value) => Math.max(value - 1, 0));

  const workspaceClass = bootError && activeView !== "settings"
    ? "workspace single"
    : activeView === "discover"
    ? `workspace discover ${!filtersCollapsed ? "filters-open" : ""} ${selectedIds.length > 0 || previewNovel ? "selection-open" : ""}`
    : "workspace single";

  return (
    <main className={`app-frame ${sidebarExpanded ? "sidebar-open" : ""}`}>
      {showSplash ? <SplashScreen done={bootDone} /> : null}
      <Sidebar activeView={activeView} expanded={sidebarExpanded} flashKey={downloadsPulse} downloading={queue.some((item) => item.state === "downloading" || item.state === "queued")} onToggle={() => setSidebarExpanded((value) => !value)} onChange={setActiveView} />
      <section className="app-shell">
        <Titlebar title={pageTitle[activeView]} />
        <div className={workspaceClass}>
          {bootError && activeView !== "settings" ? (
            <section className="boot-error">
              <div className="boot-error-card">
                <span className="boot-error-icon">
                  <CloudOff size={40} />
                </span>
                <h2>Nao foi possivel carregar o acervo</h2>
                <p>
                  O app nao conseguiu falar com o servidor de indice configurado. Ajuste o endereco
                  do servidor em Ajustes e rode o assistente inicial novamente.
                </p>
                <code className="boot-error-detail">{bootError}</code>
                <div className="boot-error-actions">
                  <button className="button primary" onClick={() => window.location.reload()}>
                    <RefreshCcw size={15} />
                    Tentar novamente
                  </button>
                  <button className="button quiet" onClick={() => setActiveView("settings")}>
                    <Settings size={15} />
                    Abrir Ajustes
                  </button>
                </div>
              </div>
            </section>
          ) : null}
          {!bootError && activeView === "discover" ? (
            <DiscoverView
              sources={sources}
              filters={filters}
              tagCatalog={tagCatalog}
              results={results}
              selectedNovels={selectedNovels}
              loading={loading || searching || filters.sourceId === "all"}
              selectedIds={selectedIds}
              detailNovel={detailNovel}
              detailFromPreview={Boolean(previewNovel)}
              filterCollapsed={filtersCollapsed}
              selections={selections}
              onFiltersChange={setFilters}
              onToggleFilters={() => setFiltersCollapsed((value) => !value)}
              onToggleNovel={toggleNovel}
              onSelectNovel={selectNovel}
              onPreviewNovel={openPreviewNovel}
              onClearPreview={clearPreviewNovel}
              onSelectionChange={(selection) => setSelections((current) => ({ ...current, [selection.novelId]: selection }))}
              onAddSelected={addSelectedToQueue}
              onReorder={setSelectedIds}
              onRemoveSelected={removeSelectedNovel}
            />
          ) : null}
          {!bootError && activeView === "sources" ? <SourcesView sources={sources} syncing={syncing} onToggle={toggleSourceEnabled} onSync={syncSource} /> : null}
          {!bootError && activeView === "downloads" ? (
            <DownloadsView
              queue={queue}
              paused={queuePaused}
              onPauseToggle={() => setQueuePaused((value) => !value)}
              onClearCompleted={clearSelectedQueue}
              onCancel={cancelDownload}
              onOpenItemFolder={openQueueItemFolder}
            />
          ) : null}
          {!bootError && activeView === "library" ? (
            <LibraryView
              library={library}
              kindleConnected={kindleConnected}
              selectedIds={selectedLibraryIds}
              onToggleSelect={toggleLibrarySelect}
              conversionFormats={converterFormats}
              conversionAudiobook={converterAudiobook}
              conversionProgress={converterProgress}
              conversionRunning={converterRunning}
              conversionCurrentItemId={converterCurrentItemId}
              onConvertSelected={startConversion}
              onToggleConversionFormat={toggleConverterFormat}
              onToggleConversionAudiobook={toggleConverterAudiobook}
              onRemoveSelected={removeSelectedLibraryItem}
              onReorderSelected={setSelectedLibraryIds}
              onOpenItemFolder={openLibraryItemFolder}
              onUpdateMeta={updateLibraryMeta}
              onDeleteItems={deleteLibraryItems}
            />
          ) : null}
          {!bootError && activeView === "translation" ? (
            <TranslationView
              backend={backend}
              library={library}
              config={appConfig}
              onConfigChange={patchConfig}
              onOpenItemFolder={openLibraryItemFolder}
              onNotify={setToast}
            />
          ) : null}
          {activeView === "settings" ? <SettingsView config={appConfig} onConfigChange={patchConfig} onOpenOnboarding={openOnboarding} /> : null}
        </div>
        <OnboardingWizard
          open={!loading && showOnboarding}
          allowClose={hasCompletedSetup()}
          step={onboardingStep}
          config={appConfig}
          sources={sources}
          serverProbe={serverProbe}
          probingServer={probingServer}
          setupSync={setupSync}
          setupSyncRunning={setupSyncRunning}
          setupSyncCompleted={setupSyncCompleted}
          onChange={patchConfig}
          onToggleSource={toggleOnboardingSource}
          onValidateServer={validateServer}
          onBack={rewindOnboarding}
          onNext={advanceOnboarding}
          onClose={closeOnboarding}
        />
        <footer className="statusbar">
          <div className="footer-meta">
            <span>Servidor: {appConfig.serverUrl}</span>
            <span>Queue: {queue.filter((item) => item.state !== "done").length} pendentes</span>
          </div>
          <div className="footer-meta">
            <span
              className="kindle-status"
              title={kindleConnected && kindleStatus ? `${kindleStatus.deviceName} - ${kindleStatus.mountPath}` : kindleStrings.disconnected}
            >
              <span className={`kindle-dot ${kindleConnected ? "online" : "offline"}`} aria-hidden="true" />
              {kindleConnected ? kindleStrings.connected : kindleStrings.disconnected}
            </span>
          </div>
        </footer>
        {toast ? <div className="app-toast" role="status">{toast}</div> : null}
      </section>
    </main>
  );
}
