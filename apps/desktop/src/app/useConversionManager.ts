import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppConfig, DownloadFormat, QueueItem } from "../core/types";
import { getErrorMessage } from "../services/backendClient";
import { runDownload, sanitizeFileName } from "../services/downloadManager";
import { joinPath } from "../services/localFiles";

type ConversionManagerArgs = {
  appConfig: AppConfig;
  refreshLocalLibrary: () => void;
  selectedCompletedItems: QueueItem[];
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  setToast: (message: string) => void;
};

export function useConversionManager({
  appConfig,
  refreshLocalLibrary,
  selectedCompletedItems,
  setQueue,
  setToast
}: ConversionManagerArgs) {
  const [converterOpen, setConverterOpen] = useState(false);
  const [converterFormats, setConverterFormats] = useState<Set<DownloadFormat>>(new Set(["EPUB"]));
  const [converterTranslate, setConverterTranslate] = useState(false);
  const [converterAudiobook, setConverterAudiobook] = useState(false);
  const [converterProgress, setConverterProgress] = useState(0);
  const [converterRunning, setConverterRunning] = useState(false);

  const openConverter = () => {
    if (selectedCompletedItems.length === 0) return;
    setConverterFormats(new Set(appConfig.defaultFormats));
    setConverterTranslate(false);
    setConverterAudiobook(false);
    setConverterProgress(0);
    setConverterRunning(false);
    setConverterOpen(true);
  };

  const closeConverter = () => {
    if (converterRunning) return;
    setConverterOpen(false);
  };

  const startConversion = () => {
    const items = selectedCompletedItems;
    if (items.length === 0) return;
    const requestedFormats = Array.from(converterFormats);
    setConverterRunning(true);
    setConverterProgress(5);
    void (async () => {
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const missing = requestedFormats.filter((format) => !item.formats.includes(format));
        let generated: string[] = [];
        if (missing.length > 0) {
          generated = await runDownload({
            serverUrl: appConfig.serverUrl,
            novel: { id: item.novelId, title: item.title, bundleKey: item.bundleKey },
            formats: missing,
            outputDir: item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title)),
            range: item.preset === "range" && item.rangeStart && item.rangeEnd ? { start: item.rangeStart, end: item.rangeEnd } : undefined
          });
        }
        setQueue((current) => current.map((entry) => entry.id === item.id ? {
          ...entry,
          formats: Array.from(new Set([...entry.formats, ...missing])),
          outputFiles: Array.from(new Set([...(entry.outputFiles ?? []), ...generated])),
          translate: entry.translate || converterTranslate,
          audiobook: entry.audiobook || converterAudiobook
        } : entry));
        setConverterProgress(Math.round(((index + 1) / items.length) * 100));
      }
      refreshLocalLibrary();
      setConverterRunning(false);
      setConverterOpen(false);
      setToast("Conversao concluida.");
    })().catch((error: unknown) => {
      setConverterRunning(false);
      setToast(getErrorMessage(error, "Nao foi possivel converter os itens."));
    });
  };

  const toggleConverterFormat = (format: DownloadFormat) => {
    setConverterFormats((current) => {
      const next = new Set(current);
      if (next.has(format) && next.size > 1) next.delete(format);
      else next.add(format);
      return next;
    });
  };

  return {
    closeConverter,
    converterAudiobook,
    converterFormats,
    converterOpen,
    converterProgress,
    converterRunning,
    converterTranslate,
    openConverter,
    startConversion,
    toggleConverterFormat,
    toggleConverterAudiobook: () => setConverterAudiobook((value) => !value),
    toggleConverterTranslate: () => setConverterTranslate((value) => !value)
  };
}
