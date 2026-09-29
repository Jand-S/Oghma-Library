import type { Dispatch, SetStateAction } from "react";
import { useEffect, useState } from "react";
import type { SetupSyncEntry } from "../../constants/ui";
import type { AppConfig, SourceSite } from "../../core/types";
import type { BackendClient } from "../../services/backendClient";
import { getErrorMessage } from "../../services/backendClient";
import { onboardingStrings } from "../../strings/onboarding";
import { markSourcesSynced } from "../sources/lastSync";

type Deps = {
  showOnboarding: boolean;
  onboardingStep: number;
  appConfig: AppConfig;
  backend: BackendClient;
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setSyncing: Dispatch<SetStateAction<string[]>>;
};

const SYNC_STEP = onboardingStrings.steps.length - 1;

/**
 * Initial index sync of the onboarding's last step: syncs each enabled source in turn
 * and reports per-source progress. `retry()` runs it again after a failure.
 */
export function useOnboardingSync({ showOnboarding, onboardingStep, appConfig, backend, setSources, setSyncing }: Deps) {
  const [setupSync, setSetupSync] = useState<Record<string, SetupSyncEntry>>({});
  const [setupSyncRunning, setSetupSyncRunning] = useState(false);
  const [setupSyncCompleted, setSetupSyncCompleted] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!showOnboarding || onboardingStep !== SYNC_STEP || setupSyncRunning || setupSyncCompleted) return;
    const sourceIds = appConfig.enabledSourceIds;
    if (sourceIds.length === 0) {
      setSetupSyncCompleted(true);
      return;
    }

    let cancelled = false;
    const timers: number[] = [];
    let hasErrors = false;
    const { syncDetail } = onboardingStrings;

    setSetupSyncRunning(true);
    setSetupSyncCompleted(false);
    setSetupSync(Object.fromEntries(sourceIds.map((sourceId) => [sourceId, { progress: 0, status: "pending", detail: syncDetail.queued }])));

    const run = async () => {
      for (const sourceId of sourceIds) {
        if (cancelled) return;
        let progress = 6;
        setSetupSync((current) => ({
          ...current,
          [sourceId]: { progress, status: "syncing", detail: syncDetail.running }
        }));

        const timer = window.setInterval(() => {
          progress = Math.min(90, progress + 7 + Math.random() * 9);
          setSetupSync((current) => ({
            ...current,
            [sourceId]: { progress, status: "syncing", detail: syncDetail.running }
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
            [sourceId]: { progress: 100, status: "done", detail: syncDetail.done }
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
              detail: getErrorMessage(error, syncDetail.failed)
            }
          }));
        } finally {
          setSyncing((items) => items.filter((id) => id !== sourceId));
        }
      }

      if (cancelled) return;
      if (!hasErrors) markSourcesSynced();
      setSetupSyncRunning(false);
      // No toast: the step itself shows the result (and a toast would cover "Entrar no app").
      setSetupSyncCompleted(!hasErrors);
    };

    void run();

    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearInterval(timer));
    };
    // setupSyncRunning/Completed are deliberately left out: they change during the run.
  }, [appConfig.enabledSourceIds, attempt, backend, onboardingStep, showOnboarding]);

  const retry = () => {
    setSetupSync({});
    setSetupSyncRunning(false);
    setSetupSyncCompleted(false);
    setAttempt((value) => value + 1);
  };

  return { setupSync, setupSyncRunning, setupSyncCompleted, setSetupSync, setSetupSyncRunning, setSetupSyncCompleted, retry };
}
