import { useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { AppConfig, QueueItem, Novel } from "../core/types";
import { getErrorMessage } from "../services/backendClient";
import { runDownload, sanitizeFileName } from "../services/downloadManager";
import { joinPath } from "../services/localFiles";

type DownloadProcessorArgs = {
  appConfig: AppConfig;
  autoSelectedRef: MutableRefObject<Set<string>>;
  queue: QueueItem[];
  queuePaused: boolean;
  refreshLocalLibrary: () => void;
  results: Novel[];
  saveCoverForItem: (item: QueueItem, outputDir: string) => Promise<void>;
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  setToast: (message: string) => void;
};

export function useDownloadProcessor({
  appConfig,
  autoSelectedRef,
  queue,
  queuePaused,
  refreshLocalLibrary,
  results,
  saveCoverForItem,
  setQueue,
  setToast
}: DownloadProcessorArgs) {
  const processingDownloadRef = useRef<string | null>(null);

  useEffect(() => {
    if (queuePaused || processingDownloadRef.current) return;
    const item = queue.find((entry) => entry.state === "downloading") ?? queue.find((entry) => entry.state === "queued");
    if (!item) return;

    const sourceNovel = results.find((novel) => novel.id === item.novelId);
    const bundleKey = item.bundleKey ?? sourceNovel?.bundleKey;
    const itemOutputDir = joinPath(appConfig.outputPath, sanitizeFileName(item.title));
    const range = item.preset === "range" && item.rangeStart && item.rangeEnd
      ? { start: item.rangeStart, end: item.rangeEnd }
      : undefined;

    processingDownloadRef.current = item.id;
    setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, state: "downloading", progress: Math.max(entry.progress, 2), outputDir: itemOutputDir, error: undefined } : entry));

    void runDownload(
      {
        serverUrl: appConfig.serverUrl,
        novel: { id: item.novelId, title: item.title, bundleKey, coverUrl: item.coverUrl ?? sourceNovel?.coverUrl },
        formats: item.formats,
        outputDir: itemOutputDir,
        range
      },
      {
        onProgress: (percent) => {
          setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, progress: percent } : entry));
        }
      }
    )
      .then((files) => {
        setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, state: "done", progress: 100, outputDir: itemOutputDir, outputFiles: files } : entry));
        void saveCoverForItem(item, itemOutputDir).finally(refreshLocalLibrary);
        setToast(`${item.title} salvo em ${itemOutputDir}.`);
      })
      .catch((error: unknown) => {
        setQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, state: "error", progress: 0, outputDir: itemOutputDir, error: getErrorMessage(error, "Falha ao salvar download.") } : entry));
        setToast(getErrorMessage(error, `Nao foi possivel baixar ${item.title}.`));
      })
      .finally(() => {
        processingDownloadRef.current = null;
      });
  }, [appConfig.outputPath, appConfig.serverUrl, queue, queuePaused, refreshLocalLibrary, results, saveCoverForItem, setQueue, setToast]);

  useEffect(() => {
    const newlyDone = queue.filter((item) => item.state === "done" && !autoSelectedRef.current.has(item.id));
    if (newlyDone.length === 0) return;
    newlyDone.forEach((item) => autoSelectedRef.current.add(item.id));
  }, [autoSelectedRef, queue]);
}
