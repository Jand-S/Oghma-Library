import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { useOnboardingSync } from "../../app/useOnboardingSync";
import { onboardingSteps } from "../../constants/ui";
import { hasCompletedSetup, markSetupComplete } from "../../core/appConfig";
import type { AppConfig, ServerProbe, SourceSite } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";

type OnboardingControllerArgs = {
  backend: BackendClient;
  appConfig: AppConfig;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  showOnboarding: boolean;
  setShowOnboarding: Dispatch<SetStateAction<boolean>>;
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setSyncing: Dispatch<SetStateAction<string[]>>;
  notify: (message: string) => void;
};

/** First-run wizard state: steps, server probe and initial source sync. Moved from App.tsx unchanged. */
export function useOnboardingController({
  backend,
  appConfig,
  setAppConfig,
  showOnboarding,
  setShowOnboarding,
  setSources,
  setSyncing,
  notify
}: OnboardingControllerArgs) {
  const [onboardingStep, setOnboardingStep] = useState(0);
  const [serverProbe, setServerProbe] = useState<ServerProbe | null>(null);
  const [probingServer, setProbingServer] = useState(false);
  const {
    setupSync,
    setupSyncRunning,
    setupSyncCompleted,
    setSetupSync,
    setSetupSyncRunning,
    setSetupSyncCompleted
  } = useOnboardingSync({ showOnboarding, onboardingStep, appConfig, backend, setSources, setSyncing, setToast: notify });

  const resetServerProbe = useCallback(() => setServerProbe(null), []);

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
        notify(getErrorMessage(error, "Nao foi possivel validar o servidor informado."));
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
    notify("Configuracao inicial salva.");
  };

  const advanceOnboarding = () => {
    if (onboardingStep === onboardingSteps.length - 1) {
      completeOnboarding();
      return;
    }
    setOnboardingStep((value) => Math.min(value + 1, onboardingSteps.length - 1));
  };

  const rewindOnboarding = () => setOnboardingStep((value) => Math.max(value - 1, 0));

  return {
    showOnboarding,
    onboardingStep,
    serverProbe,
    probingServer,
    resetServerProbe,
    setupSync,
    setupSyncRunning,
    setupSyncCompleted,
    toggleOnboardingSource,
    validateServer,
    openOnboarding,
    closeOnboarding,
    advanceOnboarding,
    rewindOnboarding
  };
}

export type OnboardingController = ReturnType<typeof useOnboardingController>;
