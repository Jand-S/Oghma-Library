import { CloudOff, RefreshCcw, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NavigationProvider, useNavigation, type AppView } from "./app/NavigationContext";
import { useBootstrapState } from "./app/useBootstrapState";
import { useKindleDetection } from "./app/useKindleDetection";
import { useLocalLibrary } from "./app/useLocalLibrary";
import { contentClassFor, viewRegistry, type AppControllers } from "./app/viewRegistry";
import { hasCompletedSetup } from "./core/appConfig";
import { useDiscoverController } from "./features/discover/useDiscoverController";
import { useDownloadsController } from "./features/downloads/useDownloadsController";
import { useLibraryController } from "./features/library/useLibraryController";
import { useOnboardingController } from "./features/onboarding/useOnboardingController";
import { useSettingsController } from "./features/settings/useSettingsController";
import { useSourcesController } from "./features/sources/useSourcesController";
import { useTranslationController } from "./features/translation/useTranslationController";
import type { BackendClient } from "./services/backendClient";
import { AppShell, SplashScreen, type BootStep } from "./shell";
import { bootStrings, shellStrings } from "./strings/common";
import { Button, EmptyState, ToastProvider, useToast, type ToastTone } from "./ui";
import { OnboardingWizard } from "./views/onboarding";

type AppProps = {
  backend: BackendClient;
};

const ERROR_MESSAGE = /^n[aã]o foi poss[ií]vel/i;

export function App({ backend }: AppProps) {
  return (
    <ToastProvider>
      <NavigationProvider initialView="discover">
        <AppContent backend={backend} />
      </NavigationProvider>
    </ToastProvider>
  );
}

function AppContent({ backend }: AppProps) {
  const navigation = useNavigation();
  const { view, navigate, canGoBack, back } = navigation;
  const { toast } = useToast();

  /** String notifications from hooks and views (the old `setToast`). Errors get the danger tone. */
  const notify = useCallback((message: string) => {
    if (!message) return;
    const tone: ToastTone = ERROR_MESSAGE.test(message) ? "danger" : "info";
    toast({ message, tone });
  }, [toast]);

  const { kindleStatus, setKindleStatus } = useKindleDetection(false);
  const bootstrap = useBootstrapState({ backend, setKindleStatus });
  const {
    appConfig,
    autoSelectedRef,
    bootDone,
    bootError,
    focusedNovelId,
    library,
    loading,
    queue,
    results,
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
  } = bootstrap;
  const kindleConnected = kindleStatus?.connected ?? false;

  const { refreshLocalLibrary, saveCoverForItem } = useLocalLibrary({ appConfig, loading, results, setLibrary });

  const downloads = useDownloadsController({
    appConfig,
    autoSelectedRef,
    queue,
    setQueue,
    refreshLocalLibrary,
    results,
    saveCoverForItem,
    notify
  });
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
    setQueue,
    notify,
    onQueued: downloads.flash
  });
  const libraryController = useLibraryController({ appConfig, library, setLibrary, setQueue, kindleConnected, refreshLocalLibrary, notify });
  const sourcesController = useSourcesController({ backend, sources, setSources, setAppConfig, notify });
  const onboarding = useOnboardingController({
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
    onOpenOnboarding: onboarding.openOnboarding
  });
  const translation = useTranslationController({
    backend,
    library,
    config: appConfig,
    onConfigChange: settings.patchConfig,
    onOpenItemFolder: libraryController.openLibraryItemFolder,
    notify
  });

  const controllers: AppControllers = {
    loading,
    navigate,
    discover,
    downloads,
    library: libraryController,
    settings,
    sources: sourcesController,
    translation
  };

  // Keep the splash mounted while its exit animation plays.
  const [splashMounted, setSplashMounted] = useState(true);
  useEffect(() => {
    if (showSplash) return;
    const timer = window.setTimeout(() => setSplashMounted(false), 320);
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

  const goTo = (target: AppView) => navigate(target, undefined, { root: true });

  return (
    <>
      {splashMounted ? <SplashScreen steps={bootSteps} leaving={!showSplash} /> : null}
      <AppShell
        active={view}
        onNavigate={goTo}
        sidebarStatus={{ downloading: downloads.downloading, flashKey: downloads.pulse, kindleConnected }}
        header={{ title: definition.title, onBack: canGoBack ? back : undefined }}
        bottomPanel={{
          active: downloads.active,
          queuedCount: downloads.queuedCount,
          kindle: kindleStatus,
          onOpenDownloads: () => navigate("downloads")
        }}
        contentClassName={showBootError ? "workspace single" : contentClassFor(view, controllers)}
        overlays={(
          <OnboardingWizard
            open={!loading && showOnboarding}
            allowClose={hasCompletedSetup()}
            step={onboarding.onboardingStep}
            config={appConfig}
            sources={sources}
            serverProbe={onboarding.serverProbe}
            probingServer={onboarding.probingServer}
            setupSync={onboarding.setupSync}
            setupSyncRunning={onboarding.setupSyncRunning}
            setupSyncCompleted={onboarding.setupSyncCompleted}
            onChange={settings.patchConfig}
            onToggleSource={onboarding.toggleOnboardingSource}
            onValidateServer={onboarding.validateServer}
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
          <ActiveView app={controllers} />
        )}
      </AppShell>
    </>
  );
}
