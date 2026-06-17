import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { onboardingSteps } from "../constants/ui";
import type { SetupSyncEntry } from "../constants/ui";
import { getErrorMessage } from "../services/backendClient";
import type { BackendClient } from "../services/backendClient";
import type { AppConfig, SourceSite } from "../types";

type Deps = {
  showOnboarding: boolean;
  onboardingStep: number;
  appConfig: AppConfig;
  backend: BackendClient;
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setSyncing: Dispatch<SetStateAction<string[]>>;
  setToast: (message: string) => void;
};

export function useOnboardingSync({ showOnboarding, onboardingStep, appConfig, backend, setSources, setSyncing, setToast }: Deps) {
  const [setupSync, setSetupSync] = useState<Record<string, SetupSyncEntry>>({});
  const [setupSyncRunning, setSetupSyncRunning] = useState(false);
  const [setupSyncCompleted, setSetupSyncCompleted] = useState(false);
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
  return { setupSync, setupSyncRunning, setupSyncCompleted, setSetupSync, setSetupSyncRunning, setSetupSyncCompleted };
}
