import { useMemo, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { useDownloadProcessor } from "../../app/useDownloadProcessor";
import type { AppConfig, Novel, QueueItem } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { sanitizeFileName } from "../../services/downloadManager";
import { joinPath, openLocalPath } from "../../services/localFiles";
import type { ActiveDownload } from "../../shell";

/** Opens a folder in the OS file manager, or explains where it is when running in a browser. */
export function openOutputFolder(path: string, label: string, notify: (message: string) => void) {
  void openLocalPath(path)
    .then((opened) => {
      notify(opened ? `Abrindo ${label}.` : `No navegador, use a pasta configurada: ${path}`);
    })
    .catch((error: unknown) => {
      notify(getErrorMessage(error, `Nao foi possivel abrir ${label}.`));
    });
}

type DownloadsControllerArgs = {
  appConfig: AppConfig;
  autoSelectedRef: MutableRefObject<Set<string>>;
  queue: QueueItem[];
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  refreshLocalLibrary: () => void;
  results: Novel[];
  saveCoverForItem: Parameters<typeof useDownloadProcessor>[0]["saveCoverForItem"];
  notify: (message: string) => void;
};

/** Download queue state and actions. Moved from App.tsx unchanged; the queue rewrite (L1) plugs in here later. */
export function useDownloadsController({
  appConfig,
  autoSelectedRef,
  queue,
  setQueue,
  refreshLocalLibrary,
  results,
  saveCoverForItem,
  notify
}: DownloadsControllerArgs) {
  const [queuePaused, setQueuePaused] = useState(false);
  const [pulse, setPulse] = useState(0);

  useDownloadProcessor({
    appConfig,
    autoSelectedRef,
    queue,
    queuePaused,
    refreshLocalLibrary,
    results,
    saveCoverForItem,
    setQueue,
    setToast: notify
  });

  const clearCompleted = () => {
    const doneCount = queue.filter((item) => item.state === "done").length;
    if (doneCount === 0) return;
    setQueue((current) => current.filter((item) => item.state !== "done"));
    notify(`${doneCount} item(ns) concluido(s) removido(s) da fila.`);
  };

  const cancelDownload = (id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id));
    notify("Download cancelado.");
  };

  const openQueueItemFolder = (item: QueueItem) =>
    openOutputFolder(item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title)), `pasta de ${item.title}`, notify);

  const activeItem = queue.find((item) => item.state === "downloading");
  const active = useMemo<ActiveDownload | null>(
    () => (activeItem ? { title: activeItem.title, progress: activeItem.progress } : null),
    [activeItem]
  );
  const queuedCount = queue.filter((item) => item.state === "queued").length;
  const downloading = queue.some((item) => item.state === "downloading" || item.state === "queued");

  return {
    queue,
    queuePaused,
    togglePaused: () => setQueuePaused((value) => !value),
    clearCompleted,
    cancelDownload,
    openQueueItemFolder,
    active,
    queuedCount,
    downloading,
    pulse,
    flash: () => setPulse((value) => value + 1)
  };
}

export type DownloadsController = ReturnType<typeof useDownloadsController>;
