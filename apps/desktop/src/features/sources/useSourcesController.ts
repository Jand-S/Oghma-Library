import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppConfig, IndexMode, ServerProbe, SourceSite } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { sourcesStrings } from "../../strings/sources";
import { markSourcesSynced, useLastSync } from "./lastSync";

type SourcesControllerArgs = {
  backend: BackendClient;
  sources: SourceSite[];
  setSources: Dispatch<SetStateAction<SourceSite[]>>;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  notify: (message: string) => void;
};

/** Result of the last "Verificar servidor" run from Ajustes. */
export type ServerCheck = {
  probe: ServerProbe | null;
  checking: boolean;
  /** Error message of the last failed check, for the URL whose check failed. */
  error: string | null;
  errorUrl: string | null;
};

/**
 * Source list sync and enable/disable, plus the index-server check used by Ajustes.
 * The backend client lives here, so Ajustes can probe the server without extra App wiring.
 */
export function useSourcesController({ backend, sources, setSources, setAppConfig, notify }: SourcesControllerArgs) {
  const [syncing, setSyncing] = useState<string[]>([]);
  const syncingRef = useRef<string[]>([]);
  syncingRef.current = syncing;
  const lastSyncedAt = useLastSync();
  const [serverCheck, setServerCheck] = useState<ServerCheck>({ probe: null, checking: false, error: null, errorUrl: null });

  const runSourceSync = async (sourceId: string, options?: { silentError?: boolean }) => {
    if (syncingRef.current.includes(sourceId)) return undefined;
    syncingRef.current = [...syncingRef.current, sourceId];
    setSyncing((items) => items.includes(sourceId) ? items : [...items, sourceId]);
    try {
      const updated = await backend.syncSource(sourceId);
      setSources((items) => items.map((source) => source.id === sourceId ? { ...updated, enabled: source.enabled } : source));
      markSourcesSynced();
      return updated;
    } catch (error: unknown) {
      if (!options?.silentError) {
        notify(getErrorMessage(error, sourcesStrings.syncFailed));
      }
      throw error;
    } finally {
      syncingRef.current = syncingRef.current.filter((id) => id !== sourceId);
      setSyncing((items) => items.filter((id) => id !== sourceId));
    }
  };

  const syncSource = (sourceId: string) => {
    void runSourceSync(sourceId).catch(() => undefined);
  };

  /** Syncs every enabled source and reports once. Resolves to true when all succeeded. */
  const syncEnabledSources = async () => {
    const ids = sources.filter((source) => source.enabled).map((source) => source.id);
    if (ids.length === 0) return false;
    const results = await Promise.allSettled(ids.map((id) => runSourceSync(id, { silentError: true })));
    const ok = results.every((result) => result.status === "fulfilled");
    notify(ok ? sourcesStrings.syncAllDone : sourcesStrings.syncAllFailed);
    return ok;
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

  /**
   * Fonte nova vinda de um pedido: recarrega o índice, coloca a fonte na lista (se ainda não
   * estiver), ativa e sincroniza. Usado pelo botão "Adicionar e sincronizar".
   */
  const addSource = async (sourceId: string) => {
    const known = sources.find((source) => source.id === sourceId);
    if (known) {
      if (!known.enabled) toggleSourceEnabled(sourceId);
      await runSourceSync(sourceId).catch(() => undefined);
      return;
    }
    if (syncingRef.current.includes(sourceId)) return;
    syncingRef.current = [...syncingRef.current, sourceId];
    setSyncing((items) => [...items, sourceId]);
    try {
      const fresh = await backend.syncSource(sourceId);
      setSources((items) => items.some((item) => item.id === sourceId) ? items : [...items, { ...fresh, enabled: true }]);
      setAppConfig((current) => current.enabledSourceIds.includes(sourceId)
        ? current
        : { ...current, enabledSourceIds: [...current.enabledSourceIds, sourceId] });
      markSourcesSynced();
    } catch (error: unknown) {
      notify(getErrorMessage(error, sourcesStrings.syncFailed));
    } finally {
      syncingRef.current = syncingRef.current.filter((id) => id !== sourceId);
      setSyncing((items) => items.filter((id) => id !== sourceId));
    }
  };

  /** Probes the index server; the result is shown inline (no toast). */
  const verifyServer = useCallback((serverUrl: string, indexMode: IndexMode) => {
    const url = serverUrl.trim();
    if (!url) return;
    setServerCheck((current) => ({ ...current, checking: true, error: null, errorUrl: null }));
    void backend.validateServer(url, indexMode)
      .then((probe) => setServerCheck({ probe, checking: false, error: null, errorUrl: null }))
      .catch((error: unknown) => setServerCheck({
        probe: null,
        checking: false,
        error: getErrorMessage(error, "Não foi possível validar o servidor informado."),
        errorUrl: url
      }));
  }, [backend]);

  return {
    sources,
    syncing,
    setSyncing,
    syncSource,
    syncEnabledSources,
    toggleSourceEnabled,
    addSource,
    notify,
    lastSyncedAt,
    serverCheck,
    verifyServer
  };
}

export type SourcesController = ReturnType<typeof useSourcesController>;
