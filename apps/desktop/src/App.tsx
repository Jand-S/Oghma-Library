import { useEffect, useMemo, useRef, useState } from "react";
import { CloudOff, RefreshCcw, Settings } from "lucide-react";
import {
  defaultAppConfig,
  hasCompletedSetup,
  markSetupComplete,
  readStoredConfig,
  resolveAppConfig,
  writeStoredConfig
} from "./appConfig";
import {
  DiscoverView,
  DownloadsView,
  KindleTransferModal,
  LibraryView,
  onboardingSteps,
  OnboardingWizard,
  pageTitle,
  SettingsView,
  Sidebar,
  SourcesView,
  SplashScreen,
  type SetupSyncEntry,
  Titlebar
} from "./appUi";
import { defaultFilters, defaultSelection, mockBackendClient } from "./mockBackend";
import { getErrorMessage, type BackendClient } from "./services/backendClient";
import type {
  AppConfig,
  BootstrapPayload,
  ChapterSelection,
  Filters,
  KindleDeviceStatus,
  LibraryItem,
  Novel,
  QueueItem,
  ServerProbe,
  SourceSite,
  ViewId
} from "./types";

type AppProps = {
  backend?: BackendClient;
};

export function App({ backend = mockBackendClient }: AppProps) {
  const storedConfigRef = useRef(readStoredConfig());
  const storedConfig = storedConfigRef.current;
  const [bootAttempt, setBootAttempt] = useState(0);
  const [bootDone, setBootDone] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedSetup());
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [activeView, setActiveView] = useState<ViewId>("discover");
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [appConfig, setAppConfig] = useState<AppConfig>(() => resolveAppConfig(storedConfig));
  const [serverProbe, setServerProbe] = useState<ServerProbe | null>(null);
  const [probingServer, setProbingServer] = useState(false);
  const [setupSync, setSetupSync] = useState<Record<string, SetupSyncEntry>>({});
  const [setupSyncRunning, setSetupSyncRunning] = useState(false);
  const [setupSyncCompleted, setSetupSyncCompleted] = useState(false);
  const [sources, setSources] = useState<SourceSite[]>([]);
  const [results, setResults] = useState<Novel[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [kindleStatus, setKindleStatus] = useState<KindleDeviceStatus | null>(null);
  const [selectedQueueIds, setSelectedQueueIds] = useState<string[]>([]);
  const autoSelectedRef = useRef<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [focusedNovelId, setFocusedNovelId] = useState<string>("");
  const [selections, setSelections] = useState<Record<string, ChapterSelection>>({});
  const [syncing, setSyncing] = useState<string[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [kindleModalOpen, setKindleModalOpen] = useState(false);
  const [kindleJobItems, setKindleJobItems] = useState<QueueItem[]>([]);
  const [kindleSending, setKindleSending] = useState(false);
  const [kindleCompleted, setKindleCompleted] = useState(false);
  const [kindleProgress, setKindleProgress] = useState(0);
  const [toast, setToast] = useState("");
  const skippedInitialSearch = useRef(false);

  useEffect(() => {
    let mounted = true;
    let splashTimer = 0;

    setLoading(true);
    setBootDone(false);
    setBootError(null);

    void Promise.all([backend.bootstrap(), backend.getKindleStatus()])
      .then(([payload, deviceStatus]: [BootstrapPayload, KindleDeviceStatus]) => {
        if (!mounted) return;
        const fallbackSourceIds = payload.sources.filter((source) => source.enabled).map((source) => source.id);
        const effectiveConfig = resolveAppConfig(storedConfig, fallbackSourceIds);

        setAppConfig(effectiveConfig);
        setSources(payload.sources.map((source) => ({ ...source, enabled: effectiveConfig.enabledSourceIds.includes(source.id) })));
        setResults(payload.novels);
        setLibrary(payload.library);
        autoSelectedRef.current = new Set(payload.queue.filter((item) => item.state === "done").map((item) => item.id));
        setQueue(payload.queue);
        setKindleStatus(deviceStatus);
        setFocusedNovelId(payload.novels[0]?.id ?? "");
        setLoading(false);
        setBootDone(true);
        splashTimer = window.setTimeout(() => setShowSplash(false), 520);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setBootError(getErrorMessage(error, "Nao foi possivel carregar o estado inicial do app."));
        setLoading(false);
        setBootDone(true);
        setShowSplash(false);
      });

    return () => {
      mounted = false;
      window.clearTimeout(splashTimer);
    };
  }, [backend, bootAttempt, storedConfig]);

  useEffect(() => {
    if (loading) return;
    writeStoredConfig(appConfig);
  }, [appConfig, loading]);

  useEffect(() => {
    if (!showOnboarding || onboardingStep !== onboardingSteps.length - 1 || setupSyncRunning || setupSyncCompleted) return;
    const sourceIds = appConfig.enabledSourceIds;
    if (sourceIds.length === 0) {
      setSetupSyncCompleted(true);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    let hasErrors = false;

    setSetupSyncRunning(true);
    setSetupSyncCompleted(false);
    setSetupSync(Object.fromEntries(sourceIds.map((sourceId) => [sourceId, { progress: 0, status: "pending", detail: "Na fila de sincronizacao" }])));

    const run = async () => {
      for (const sourceId of sourceIds) {
        if (cancelled) return;
        let progress = 6;
        setSetupSync((current) => ({
          ...current,
          [sourceId]: { progress, status: "syncing", detail: "Baixando indices e capitulos conhecidos" }
        }));

        const timer = window.setInterval(() => {
          progress = Math.min(90, progress + 7 + Math.random() * 9);
          setSetupSync((current) => ({
            ...current,
            [sourceId]: { progress, status: "syncing", detail: "Baixando indices e capitulos conhecidos" }
          }));
        }, 140);
        timers.push(timer);

        try {
          setSyncing((items) => items.includes(sourceId) ? items : [...items, sourceId]);
          const updated = await backend.syncSource(sourceId);
          window.clearInterval(timer);
          if (cancelled) return;

          setSources((items) => items.map((source) => source.id === sourceId ? { ...updated, enabled: source.enabled } : source));
          setSetupSync((current) => ({
            ...current,
            [sourceId]: { progress: 100, status: "done", detail: "Indices prontos para busca local" }
          }));
        } catch (error: unknown) {
          hasErrors = true;
          window.clearInterval(timer);
          if (cancelled) return;
          setSetupSync((current) => ({
            ...current,
            [sourceId]: {
              progress,
              status: "error",
              detail: getErrorMessage(error, "Falha ao sincronizar a fonte.")
            }
          }));
        } finally {
          setSyncing((items) => items.filter((id) => id !== sourceId));
        }
      }

      if (cancelled) return;
      setSetupSyncRunning(false);
      setSetupSyncCompleted(!hasErrors);
      setToast(hasErrors ? "Uma ou mais fontes falharam na sincronizacao inicial." : "Indices iniciais baixados com sucesso.");
    };

    void run();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearInterval(timer));
    };
  }, [appConfig.enabledSourceIds, backend, onboardingStep, showOnboarding]);

  useEffect(() => {
    if (loading) return;
    if (!skippedInitialSearch.current) {
      skippedInitialSearch.current = true;
      return;
    }
    let cancelled = false;
    setSearching(true);

    void backend.searchNovels(filters)
      .then((items) => {
        if (cancelled) return;
        setResults(items);
        if (items.length > 0 && !items.some((item) => item.id === focusedNovelId)) {
          setFocusedNovelId(items[0].id);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setToast(getErrorMessage(error, "Nao foi possivel atualizar os resultados da busca."));
      })
      .finally(() => {
        if (cancelled) return;
        setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backend, filters, focusedNovelId, loading]);

  const focusedNovel = useMemo(() => results.find((novel) => novel.id === focusedNovelId), [focusedNovelId, results]);
  const kindleConnected = kindleStatus?.connected ?? false;

  useEffect(() => {
    if (queuePaused) return;
    const timer = window.setInterval(() => {
      setQueue((items) => {
        const active = items.find((item) => item.state === "downloading");
        if (!active) {
          const firstQueued = items.find((item) => item.state === "queued");
          if (!firstQueued) return items;
          return items.map((item) => item.id === firstQueued.id ? { ...item, state: "downloading" } : item);
        }
        return items.map((item) => {
          if (item.id !== active.id) return item;
          const next = Math.min(100, item.progress + 3 + Math.random() * 4);
          return { ...item, progress: next, state: next >= 100 ? "done" : "downloading" };
        });
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, [queuePaused]);

  useEffect(() => {
    const newlyDone = queue.filter((item) => item.state === "done" && !autoSelectedRef.current.has(item.id));
    if (newlyDone.length === 0) return;
    newlyDone.forEach((item) => autoSelectedRef.current.add(item.id));
    setSelectedQueueIds((ids) => {
      const additions = newlyDone.map((item) => item.id).filter((id) => !ids.includes(id));
      return additions.length > 0 ? [...ids, ...additions] : ids;
    });
  }, [queue]);

  const selectedNovels = useMemo(
    () => selectedIds.map((id) => results.find((novel) => novel.id === id)).filter((novel): novel is Novel => Boolean(novel)),
    [results, selectedIds]
  );
  const selectedCompletedItems = useMemo(
    () => queue.filter((item) => item.state === "done" && selectedQueueIds.includes(item.id)),
    [queue, selectedQueueIds]
  );
  const kindleDisabledReason = useMemo(() => {
    if (!kindleConnected) return "Kindle desconectado.";
    if (selectedCompletedItems.length === 0) return "Selecione ao menos um livro concluido.";
    if (selectedCompletedItems.some((item) => !item.formats.includes("EPUB"))) {
      return "Somente livros com EPUB podem ser enviados ao Kindle.";
    }
    return undefined;
  }, [kindleConnected, selectedCompletedItems]);
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

  const toggleQueueSelect = (id: string) =>
    setSelectedQueueIds((ids) => (ids.includes(id) ? ids.filter((value) => value !== id) : [...ids, id]));

  const toggleQueueSelectAll = () =>
    setSelectedQueueIds((ids) => {
      const selectable = queue.filter((item) => item.state === "done").map((item) => item.id);
      const allSelected = selectable.length > 0 && selectable.every((id) => ids.includes(id));
      return allSelected ? [] : selectable;
    });

  const exportSelectedToLibrary = () => {
    const items = queue.filter((item) => selectedQueueIds.includes(item.id) && item.state === "done");
    if (items.length === 0) return;
    setLibrary((lib) => {
      const additions = items
        .filter((item) => !lib.some((entry) => entry.id === `lib-${item.id}`))
        .map((item) => ({
          id: `lib-${item.id}`,
          title: item.title,
          author: results.find((novel) => novel.id === item.novelId)?.author ?? "Desconhecido",
          format: item.formats[0],
          chapters: item.chaptersTotal,
          sizeMb: Math.max(1, Math.round(item.chaptersTotal * 0.3)),
          coverClass: item.coverClass,
          exportedAt: "Agora"
        }));
      return [...additions, ...lib];
    });
    const ids = items.map((item) => item.id);
    setQueue((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedQueueIds([]);
    setToast(`${items.length} item(ns) exportado(s) para a biblioteca.`);
  };

  const clearSelectedQueue = () => {
    const ids = queue
      .filter((item) => selectedQueueIds.includes(item.id) && item.state === "done")
      .map((item) => item.id);
    if (ids.length === 0) return;
    setQueue((current) => current.filter((item) => !ids.includes(item.id)));
    setSelectedQueueIds([]);
    setToast(`${ids.length} item(ns) removido(s) da fila.`);
  };

  const cancelDownload = (id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id));
    setSelectedQueueIds((ids) => ids.filter((value) => value !== id));
    setToast("Download cancelado.");
  };

  const openKindleTransfer = () => {
    if (kindleDisabledReason) return;
    setKindleJobItems(selectedCompletedItems);
    setKindleProgress(0);
    setKindleCompleted(false);
    setKindleSending(false);
    setKindleModalOpen(true);
  };

  const closeKindleTransfer = () => {
    if (kindleSending) return;
    setKindleModalOpen(false);
    setKindleCompleted(false);
    setKindleProgress(0);
    setKindleJobItems([]);
  };

  const startKindleTransfer = () => {
    if (kindleJobItems.length === 0) return;
    setKindleProgress(0);
    setKindleCompleted(false);
    setKindleSending(true);
  };

  const openLibraryFolder = () => setToast("Abrindo a pasta da biblioteca local...");

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!kindleSending) return;
    if (kindleProgress >= 100) {
      let cancelled = false;
      void backend.sendToKindle(kindleJobItems)
        .then((result) => {
          if (cancelled) return;
          setKindleSending(false);
          setKindleCompleted(true);
          setToast(`${result.sentIds.length} item(ns) convertidos para ${result.convertedFormat} e enviados ao Kindle.`);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setKindleSending(false);
          setToast(getErrorMessage(error, "Nao foi possivel concluir o envio para o Kindle."));
        });
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      setKindleProgress((value) => Math.min(100, value + 12 + Math.random() * 18));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [backend, kindleJobItems, kindleProgress, kindleSending]);

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

  const retryBoot = () => {
    setShowSplash(true);
    setBootDone(false);
    setBootError(null);
    setBootAttempt((value) => value + 1);
  };

  const workspaceClass = bootError && activeView !== "settings"
    ? "workspace single"
    : activeView === "discover"
    ? `workspace discover ${!filtersCollapsed ? "filters-open" : ""} ${selectedIds.length > 0 ? "selection-open" : ""}`
    : "workspace single";

  return (
    <main className={`app-frame ${sidebarExpanded ? "sidebar-open" : ""}`}>
      {showSplash ? <SplashScreen done={bootDone} /> : null}
      <Sidebar activeView={activeView} expanded={sidebarExpanded} onToggle={() => setSidebarExpanded((value) => !value)} onChange={setActiveView} />
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
              selectedIds={selectedQueueIds}
              kindleConnected={kindleConnected}
              kindleDisabledReason={kindleDisabledReason}
              onPauseToggle={() => setQueuePaused((value) => !value)}
              onToggleSelect={toggleQueueSelect}
              onToggleSelectAll={toggleQueueSelectAll}
              onExportSelected={exportSelectedToLibrary}
              onClearSelected={clearSelectedQueue}
              onCancel={cancelDownload}
              onOpenFolder={openLibraryFolder}
              onSendToKindle={openKindleTransfer}
            />
          ) : null}
          {!bootError && activeView === "library" ? <LibraryView library={library} /> : null}
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
        <KindleTransferModal
          open={kindleModalOpen}
          items={kindleJobItems}
          progress={kindleProgress}
          sending={kindleSending}
          completed={kindleCompleted}
          onClose={closeKindleTransfer}
          onStart={startKindleTransfer}
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
