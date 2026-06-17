import { CloudOff, RefreshCcw, Settings } from "lucide-react";
import {
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
  ConversionModal,
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
  Titlebar
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
} from "./core/types";
import { getErrorMessage, type BackendClient } from "./services/backendClient";
import { sanitizeFileName } from "./services/downloadManager";
import {
  joinPath,
  openLocalPath
} from "./services/localFiles";

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
  const [serverProbe, setServerProbe] = useState<ServerProbe | null>(null);
  const [probingServer, setProbingServer] = useState(false);
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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

  const focusedNovel = useMemo(() => results.find((novel) => novel.id === focusedNovelId), [focusedNovelId, results]);
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
    () => selectedIds.map((id) => results.find((novel) => novel.id === id)).filter((novel): novel is Novel => Boolean(novel)),
    [results, selectedIds]
  );
  const selectedCompletedItems = useMemo(
    () => libraryToQueueItems(library.filter((item) => selectedLibraryIds.includes(item.id))),
    [library, selectedLibraryIds]
  );
  const {
    closeConverter,
    converterAudiobook,
    converterFormats,
    converterOpen,
    converterProgress,
    converterRunning,
    converterTranslate,
    openConverter,
    startConversion,
    toggleConverterAudiobook,
    toggleConverterFormat,
    toggleConverterTranslate
  } = useConversionManager({ appConfig, refreshLocalLibrary, selectedCompletedItems, setQueue, setToast });
  const buildDefaultSelection = (novel: Novel) => ({
    ...defaultSelection(novel),
    formats: appConfig.defaultFormats,
    translate: appConfig.translateDefault,
    audiobook: appConfig.audiobookDefault
  });

  const toggleNovel = (novel: Novel) => {
    setSelectedIds((ids) => ids.includes(novel.id) ? ids.filter((id) => id !== novel.id) : [...ids, novel.id]);
    setFocusedNovelId(novel.id);
    setSelections((current) => current[novel.id] ? current : { ...current, [novel.id]: buildDefaultSelection(novel) });
  };

  const addSelectedToQueue = () => {
    const payload = selectedNovels.map((novel) => selections[novel.id] ?? buildDefaultSelection(novel));
    if (payload.length === 0) return;
    void backend.createDownloads(payload)
      .then((items) => {
        setQueue((current) => [...current, ...items]);
        setSelectedIds([]);
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
  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? [] : [id]));

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
    ? `workspace discover ${!filtersCollapsed ? "filters-open" : ""} ${selectedIds.length > 0 ? "selection-open" : ""}`
    : "workspace single";

  return (
    <main className={`app-frame ${sidebarExpanded ? "sidebar-open" : ""}`}>
      {showSplash ? <SplashScreen done={bootDone} /> : null}
      <Sidebar activeView={activeView} expanded={sidebarExpanded} flashKey={downloadsPulse} onToggle={() => setSidebarExpanded((value) => !value)} onChange={setActiveView} />
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
              results={results}
              loading={loading || searching}
              selectedIds={selectedIds}
              focusedNovel={focusedNovel}
              filterCollapsed={filtersCollapsed}
              selections={selections}
              onFiltersChange={setFilters}
              onToggleFilters={() => setFiltersCollapsed((value) => !value)}
              onToggleNovel={toggleNovel}
              onFocusNovel={(novel) => setFocusedNovelId(novel.id)}
              onSelectionChange={(selection) => setSelections((current) => ({ ...current, [selection.novelId]: selection }))}
              onAddSelected={addSelectedToQueue}
              onReorder={setSelectedIds}
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
              selectedIds={selectedLibraryIds}
              onToggleSelect={toggleLibrarySelect}
              onConvertSelected={openConverter}
              onOpenItemFolder={openLibraryItemFolder}
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
        <ConversionModal
          open={converterOpen}
          items={selectedCompletedItems}
          formats={converterFormats}
          translate={converterTranslate}
          audiobook={converterAudiobook}
          progress={converterProgress}
          running={converterRunning}
          onToggleFormat={toggleConverterFormat}
          onToggleTranslate={toggleConverterTranslate}
          onToggleAudiobook={toggleConverterAudiobook}
          onClose={closeConverter}
          onStart={startConversion}
        />
        <footer className="statusbar">
          <div className="footer-meta">
            <span>Servidor: {appConfig.serverUrl}</span>
            <span>Queue: {queue.filter((item) => item.state !== "done").length} pendentes</span>
          </div>
          <div className="footer-meta">
            <span
              className="kindle-status"
              title={kindleConnected && kindleStatus ? `${kindleStatus.deviceName} - ${kindleStatus.mountPath}` : "Kindle desconectado"}
            >
              <span className={`kindle-dot ${kindleConnected ? "online" : "offline"}`} aria-hidden="true" />
              {kindleConnected ? "Kindle conectado" : "Kindle desconectado"}
            </span>
          </div>
        </footer>
        {toast ? <div className="app-toast" role="status">{toast}</div> : null}
      </section>
    </main>
  );
}
