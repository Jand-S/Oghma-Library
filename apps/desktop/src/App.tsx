import { CloudOff, RefreshCcw, Settings } from "lucide-react";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavigationProvider, useNavigation, type AppView } from "./app/NavigationContext";
import { accountOf } from "./app/account";
import { useBootstrapState } from "./app/useBootstrapState";
import { useKindleDetection } from "./app/useKindleDetection";
import { useLocalLibrary } from "./app/useLocalLibrary";
import { preloadViews, viewRegistry, type AppControllers } from "./app/viewRegistry";
import { hasCompletedSetup } from "./core/appConfig";
import { isTauriRuntime } from "./core/windowControls";
import { useDiscoverController } from "./features/discover/useDiscoverController";
import { useDownloadsController } from "./features/downloads/useDownloadsController";
import { useLibraryController } from "./features/library/useLibraryController";
import { useOnboardingController } from "./features/onboarding/useOnboardingController";
import { useSettingsController } from "./features/settings/useSettingsController";
import { useSourcesController } from "./features/sources/useSourcesController";
import { useTranslationController } from "./features/translation/useTranslationController";
import type { BackendClient } from "./services/backendClient";
import { getDownloadQueue, type DownloadQueue } from "./services/downloadQueue";
import type { TranslationClient } from "./services/translationClient";
import { openLocalPath } from "./services/localFiles";
import { AppShell, SplashScreen, type BootStep } from "./shell";
import { bootStrings, shellStrings } from "./strings/common";
import { downloadsStrings } from "./strings/downloads";
import { Button, EmptyState, ToastProvider, useToast, type ToastTone } from "./ui";
import { OnboardingWizard } from "./features/onboarding/OnboardingView";
import { readUiPreferences } from "./features/settings/preferences";

type AppProps = {
  backend: BackendClient;
  /** Download queue store; defaults to the app-wide singleton (tests inject their own). */
  downloadQueue?: DownloadQueue;
  /** Translation engine transport; defaults to Tauri IPC (tests inject a fake). */
  translationClient?: TranslationClient;
  /** Called after a new server URL is saved (main.tsx reloads; see useSettingsController). */
  onServerUrlChange?: () => void;
};

const ERROR_MESSAGE = /^n[aã]o foi poss[ií]vel/i;

export function App({ backend, downloadQueue, translationClient, onServerUrlChange }: AppProps) {
  return (
    <ToastProvider>
      <NavigationProvider initialView={readUiPreferences().startPage}>
        <AppContent backend={backend} downloadQueue={downloadQueue} translationClient={translationClient} onServerUrlChange={onServerUrlChange} />
      </NavigationProvider>
    </ToastProvider>
  );
}

function AppContent({ backend, downloadQueue, translationClient, onServerUrlChange }: AppProps) {
  const navigation = useNavigation();
  const { view, params, navigate, canGoBack, back } = navigation;
  const { toast } = useToast();

  /** String notifications from hooks and views (the old `setToast`). Callers that report an
   *  error pass "danger"; without a tone, messages starting with "Não foi possível" are errors. */
  const notify = useCallback((message: string, tone?: ToastTone) => {
    if (!message) return;
    toast({ message, tone: tone ?? (ERROR_MESSAGE.test(message) ? "danger" : "info") });
  }, [toast]);

  const { kindleStatus, seedKindleStatus } = useKindleDetection(false);
  const bootstrap = useBootstrapState({ backend, setKindleStatus: seedKindleStatus });
  const {
    appConfig,
    bootDone,
    bootError,
    catalog,
    focusedNovelId,
    library,
    loading,
    results,
    setAppConfig,
    setFocusedNovelId,
    setLibrary,
    setResults,
    setShowOnboarding,
    setSources,
    showOnboarding,
    showSplash,
    sources
  } = bootstrap;
  // Books removed from the library stay in state ("Ocultos" in the Library) but nowhere else.
  const visibleLibrary = useMemo(() => library.filter((item) => !item.hidden), [library]);
  const kindleConnected = kindleStatus?.connected ?? false;

  const { refresh: refreshLocalLibrary } = useLocalLibrary({ appConfig, loading, results: catalog, setLibrary });

  const [queue] = useState(() => downloadQueue ?? getDownloadQueue());
  const downloads = useDownloadsController({ appConfig, queue, notify, toast });

  // Jobs restored from the previous session resume once the catalog/config are loaded.
  useEffect(() => {
    if (!loading && !bootError) queue.start();
  }, [bootError, loading, queue]);

  // Finished jobs: refresh the library and tell the user. Conversion jobs report through
  // the library's conversion flow instead.
  useEffect(() => {
    const unsubscribe = queue.onEvent(({ type, job }) => {
      if (type === "committed") refreshLocalLibrary();
      if (job.kind !== "download") return;
      if (type === "committed") {
        const finalDir = job.finalDir;
        toast({
          message: job.warning ? downloadsStrings.committedWithWarning(job.title, job.warning) : downloadsStrings.committed(job.title),
          tone: job.warning ? "warning" : "success",
          action: finalDir && isTauriRuntime()
            ? { label: downloadsStrings.openFolder, onClick: () => void openLocalPath(finalDir).catch(() => undefined) }
            : undefined
        });
      } else if (type === "failed") {
        toast({ message: downloadsStrings.failedToast(job.title, job.error), tone: "danger" });
      } else {
        toast({ message: downloadsStrings.canceledToast(job.title), tone: "info" });
      }
    });
    return () => {
      unsubscribe();
    };
  }, [queue, refreshLocalLibrary, toast]);
  // Owns the ChatGPT account too (controllers.account). Also refreshes the library when a PT-BR book is exported (`translation://exported`).
  const translation = useTranslationController({
    client: translationClient,
    library: visibleLibrary,
    toast,
    refreshLibrary: refreshLocalLibrary,
    navigate
  });
  const account = accountOf(translation);
  const discover = useDiscoverController({
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
    library: visibleLibrary,
    isQueued: downloads.isQueued,
    enqueueDownload: downloads.enqueueDownload,
    notify,
    aiAvailable: account.loggedIn
  });
  const libraryController = useLibraryController({
    backend,
    appConfig,
    library,
    setLibrary,
    queue,
    enqueueDownload: downloads.enqueueDownload,
    kindleConnected,
    kindleStatus,
    refreshLocalLibrary,
    notify,
    toast
  });
  const sourcesController = useSourcesController({ backend, sources, setSources, setAppConfig, notify });
  // Settings is created after onboarding (it needs onboarding.resetServerProbe): a ref links them.
  const restartIfServerChangedRef = useRef<() => void>(() => undefined);
  const onboarding = useOnboardingController({
    onCompleted: () => restartIfServerChangedRef.current(),
    backend,
    appConfig,
    setAppConfig,
    showOnboarding,
    setShowOnboarding,
    setSources,
    setSyncing: sourcesController.setSyncing,
    notify
  });
  const settings = useSettingsController({
    appConfig,
    setAppConfig,
    onConnectionChanged: onboarding.resetServerProbe,
    onOpenOnboarding: onboarding.openOnboarding,
    onServerUrlChange
  });
  restartIfServerChangedRef.current = settings.restartIfServerChanged;

  const controllers: AppControllers = {
    loading,
    navigate,
    params,
    discover,
    downloads,
    library: libraryController,
    settings,
    sources: sourcesController,
    translation,
    account
  };

  // Once boot settles, warm the lazily loaded view chunks so navigation stays instant.
  useEffect(() => {
    if (!bootDone) return;
    void preloadViews().catch(() => undefined);
  }, [bootDone]);

  // Keep the splash mounted while its exit animation plays.
  const [splashMounted, setSplashMounted] = useState(true);
  useEffect(() => {
    if (showSplash) return;
    const timer = window.setTimeout(() => setSplashMounted(false), 200);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  const bootSteps = useMemo<BootStep[]>(() => [
    { id: "config", label: bootStrings.config, status: "done" },
    { id: "server", label: bootError ? bootStrings.failed : bootStrings.server, status: bootError ? "error" : loading ? "active" : "done" },
    { id: "catalog", label: bootStrings.catalog, status: !loading && !bootError ? "done" : "pending" },
    { id: "ready", label: bootStrings.ready, status: bootDone && !bootError ? "done" : "pending" }
  ], [bootDone, bootError, loading]);

  const showBootError = Boolean(bootError) && view !== "settings";
  const definition = viewRegistry[view];
  const ActiveView = definition.component;
  const viewHeader = showBootError ? {} : definition.header?.(controllers) ?? {};

  const goTo = (target: AppView) => navigate(target, undefined, { root: true });

  // ⌘K / Ctrl+K: jump to the Buscar search field from anywhere (Spotlight-style).
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.key.toLowerCase() !== "k") return;
      event.preventDefault();
      navigateRef.current("discover", undefined, { root: true });
      const focus = (tries: number) => {
        const field = document.querySelector<HTMLInputElement>("[data-testid='discover-search']");
        if (field) {
          field.focus();
          field.select();
        } else if (tries > 0) {
          window.setTimeout(() => focus(tries - 1), 50);
        }
      };
      window.setTimeout(() => focus(10), 0);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      {splashMounted ? <SplashScreen steps={bootSteps} leaving={!showSplash} /> : null}
      <AppShell
        active={view}
        onNavigate={goTo}
        sidebarStatus={{ downloading: downloads.downloading, flashKey: downloads.pulse, kindleConnected }}
        header={{ ...viewHeader, title: definition.title, onBack: canGoBack ? back : undefined }}
        bottomPanel={{
          active: downloads.active,
          queuedCount: downloads.queuedCount,
          kindle: kindleStatus,
          onOpenDownloads: () => navigate("downloads")
        }}
        contentLayout={showBootError ? "scroll" : definition.layout}
        overlays={(
          <OnboardingWizard
            open={!loading && showOnboarding}
            allowClose={hasCompletedSetup()}
            step={onboarding.onboardingStep}
            config={appConfig}
            sources={sources}
            serverProbe={onboarding.serverProbe}
            probingServer={onboarding.probingServer}
            serverError={onboarding.serverError}
            setupSync={onboarding.setupSync}
            setupSyncRunning={onboarding.setupSyncRunning}
            setupSyncCompleted={onboarding.setupSyncCompleted}
            onChange={settings.patchConfigDraft}
            onToggleSource={onboarding.toggleOnboardingSource}
            onValidateServer={onboarding.validateServer}
            onRetrySync={onboarding.retrySync}
            onBack={onboarding.rewindOnboarding}
            onNext={onboarding.advanceOnboarding}
            onClose={onboarding.closeOnboarding}
          />
        )}
      >
        {showBootError ? (
          <div className="o-app__center">
            <EmptyState
              tone="danger"
              icon={<CloudOff />}
              title={shellStrings.bootErrorTitle}
              description={shellStrings.bootErrorDescription}
              action={(
                <>
                  <Button variant="primary" icon={<RefreshCcw />} onClick={() => window.location.reload()}>{shellStrings.retry}</Button>
                  <Button variant="outline" icon={<Settings />} onClick={() => navigate("settings")}>{shellStrings.openSettings}</Button>
                </>
              )}
            >
              <code className="is-selectable">{bootError}</code>
            </EmptyState>
          </div>
        ) : (
          <Suspense fallback={null}>
            <ActiveView app={controllers} />
          </Suspense>
        )}
      </AppShell>
    </>
  );
}
