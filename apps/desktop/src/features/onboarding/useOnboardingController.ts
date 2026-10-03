import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { hasCompletedSetup, markSetupComplete } from "../../core/appConfig";
import type { AppConfig, ServerProbe, SourceSite } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { onboardingStrings } from "../../strings/onboarding";
import { useOnboardingSync } from "./useOnboardingSync";

type OnboardingControllerArgs = {
  backend: BackendClient;
  appConfig: AppConfig;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  showOnboarding: boolean;
  setShowOnboarding: Dispatch<SetStateAction<boolean>>;
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setSyncing: Dispatch<SetStateAction<string[]>>;
  notify: (message: string) => void;
  /** After the setup is saved (App restarts if the server URL changed during onboarding). */
  onCompleted?: () => void;
};

const LAST_STEP = onboardingStrings.steps.length - 1;

/** First-run wizard state: steps, server probe and initial source sync. */
export function useOnboardingController({
  backend,
  appConfig,
  setAppConfig,
  showOnboarding,
  setShowOnboarding,
  setSources,
  setSyncing,
  notify,
  onCompleted
}: OnboardingControllerArgs) {
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [serverProbe, setServerProbe] = useState<ServerProbe | null>(null);
  const [probingServer, setProbingServer] = useState(false);
  /** Last probe error and the URL it was for; shown inline in the Servidor step. */
  const [serverError, setServerError] = useState<{ url: string; message: string } | null>(null);
  const {
    setupSync,
    setupSyncRunning,
    setupSyncCompleted,
    setSetupSync,
    setSetupSyncRunning,
    setSetupSyncCompleted,
    retry: retrySync
  } = useOnboardingSync({ showOnboarding, onboardingStep, appConfig, backend, setSources, setSyncing });

  const resetServerProbe = useCallback(() => {
    setServerProbe(null);
    setServerError(null);
  }, []);

  const toggleOnboardingSource = (sourceId: string) => {
    setAppConfig((current) => {
      const enabledSourceIds = current.enabledSourceIds.includes(sourceId)
        ? current.enabledSourceIds.filter((id) => id !== sourceId)
        : [...current.enabledSourceIds, sourceId];
      return { ...current, enabledSourceIds };
    });
  };

  const validateServer = () => {
    const url = appConfig.serverUrl;
    if (probingServer || url.trim().length === 0) return;
    setProbingServer(true);
    setServerError(null);
    void backend.validateServer(url, appConfig.indexMode)
      .then((probe) => {
        setServerProbe(probe);
      })
      .catch((error: unknown) => {
        const message = getErrorMessage(error, onboardingStrings.validateFailed);
        setServerProbe(null);
        setServerError({ url, message });
      })
      .finally(() => {
        setProbingServer(false);
      });
  };

  const resetSync = () => {
    setSetupSync({});
    setSetupSyncRunning(false);
    setSetupSyncCompleted(false);
  };

  const openOnboarding = () => {
    setOnboardingStep(0);
    resetSync();
    setShowOnboarding(true);
  };

  const closeOnboarding = () => {
    if (!hasCompletedSetup()) return;
    resetSync();
    setShowOnboarding(false);
  };

  const completeOnboarding = () => {
    markSetupComplete();
    setSources((items) => items.map((source) => ({ ...source, enabled: appConfig.enabledSourceIds.includes(source.id) })));
    setShowOnboarding(false);
    setOnboardingStep(0);
    resetSync();
    notify(onboardingStrings.setupSaved);
    onCompleted?.();
  };

  const advanceOnboarding = () => {
    if (onboardingStep === LAST_STEP) {
      completeOnboarding();
      return;
    }
    setOnboardingStep((value) => Math.min(value + 1, LAST_STEP));
  };

  const rewindOnboarding = () => setOnboardingStep((value) => Math.max(value - 1, 0));

  return {
    showOnboarding,
    onboardingStep,
    serverProbe,
    probingServer,
    serverError: serverError && serverError.url === appConfig.serverUrl ? serverError.message : null,
    resetServerProbe,
    setupSync,
    setupSyncRunning,
    setupSyncCompleted,
    retrySync,
    toggleOnboardingSource,
    validateServer,
    openOnboarding,
    closeOnboarding,
    advanceOnboarding,
    rewindOnboarding
  };
}

