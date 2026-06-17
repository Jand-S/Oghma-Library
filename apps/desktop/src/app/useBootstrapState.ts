import { useEffect, useRef, useState } from "react";
import {
  hasCompletedSetup,
  readStoredConfig,
  resolveAppConfig,
  writeStoredConfig
} from "../core/appConfig";
import type {
  AppConfig,
  BootstrapPayload,
  KindleDeviceStatus,
  LibraryItem,
  Novel,
  QueueItem,
  SourceSite,
  ViewId
} from "../core/types";
import { getErrorMessage, type BackendClient } from "../services/backendClient";

type BootstrapStateArgs = {
  backend: BackendClient;
  setKindleStatus: (status: KindleDeviceStatus) => void;
};

export function useBootstrapState({ backend, setKindleStatus }: BootstrapStateArgs) {
  const storedConfigRef = useRef(readStoredConfig());
  const storedConfig = storedConfigRef.current;
  const autoSelectedRef = useRef<Set<string>>(new Set());

  const [bootDone, setBootDone] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(!hasCompletedSetup());
  const [activeView, setActiveView] = useState<ViewId>("discover");
  const [appConfig, setAppConfig] = useState<AppConfig>(() => resolveAppConfig(storedConfig));
  const [sources, setSources] = useState<SourceSite[]>([]);
  const [results, setResults] = useState<Novel[]>([]);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedNovelId, setFocusedNovelId] = useState("");

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
  }, [backend, setKindleStatus, storedConfig]);

  useEffect(() => {
    if (loading) return;
    writeStoredConfig(appConfig);
  }, [appConfig, loading]);

  return {
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
    setBootError,
    setFocusedNovelId,
    setLibrary,
    setQueue,
    setResults,
    setShowOnboarding,
    setSources,
    showOnboarding,
    showSplash,
    sources
  };
}
