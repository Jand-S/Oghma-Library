import { useState, type Dispatch, type SetStateAction } from "react";
import type { AppConfig, SourceSite } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";

type SourcesControllerArgs = {
  backend: BackendClient;
  sources: SourceSite[];
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  notify: (message: string) => void;
};

/** Source list sync and enable/disable. Moved from App.tsx unchanged. */
export function useSourcesController({ backend, sources, setSources, setAppConfig, notify }: SourcesControllerArgs) {
  const [syncing, setSyncing] = useState<string[]>([]);

  const runSourceSync = async (sourceId: string, options?: { silentError?: boolean }) => {
    if (syncing.includes(sourceId)) return;
    setSyncing((items) => items.includes(sourceId) ? items : [...items, sourceId]);
    try {
      const updated = await backend.syncSource(sourceId);
      setSources((items) => items.map((source) => source.id === sourceId ? { ...updated, enabled: source.enabled } : source));
      return updated;
    } catch (error: unknown) {
      if (!options?.silentError) {
        notify(getErrorMessage(error, "Nao foi possivel sincronizar a fonte."));
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

  return { sources, syncing, setSyncing, syncSource, toggleSourceEnabled };
}

export type SourcesController = ReturnType<typeof useSourcesController>;
