import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { AppConfig, DownloadFormat, QueueItem } from "../core/types";
import { downloadFormats } from "../core/types";
import { getErrorMessage } from "../services/backendClient";
import { runDownload, sanitizeFileName } from "../services/downloadManager";
import { convertLocalEpubToAzw3, joinPath, sendItemsToKindle } from "../services/localFiles";

type ConversionManagerArgs = {
  appConfig: AppConfig;
  kindleConnected: boolean;
  refreshLocalLibrary: () => void;
  selectedCompletedItems: QueueItem[];
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  setToast: (message: string) => void;
};

export function useConversionManager({
  appConfig,
  kindleConnected,
  refreshLocalLibrary,
  selectedCompletedItems,
  setQueue,
  setToast
}: ConversionManagerArgs) {
  const [converterOpen, setConverterOpen] = useState(false);
  const [converterFormats, setConverterFormats] = useState<Set<DownloadFormat>>(new Set(appConfig.defaultFormats));
  const [converterTranslate, setConverterTranslate] = useState(false);
  const [converterAudiobook, setConverterAudiobook] = useState(false);
  const [converterProgress, setConverterProgress] = useState(0);
  const [converterRunning, setConverterRunning] = useState(false);
  const [converterCurrentItemId, setConverterCurrentItemId] = useState<string | null>(null);

  useEffect(() => {
    if (kindleConnected) {
      setConverterFormats(new Set(["AZW3"]));
      setConverterAudiobook(false);
    } else {
      setConverterFormats(new Set(appConfig.defaultFormats));
    }
  }, [appConfig.defaultFormats, kindleConnected]);

  const openConverter = () => {
    if (selectedCompletedItems.length === 0) return;
    setConverterFormats(new Set(kindleConnected ? ["AZW3"] : appConfig.defaultFormats));
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
    const sendToKindle = kindleConnected;
    const requestedFormats: DownloadFormat[] = sendToKindle ? ["AZW3"] : Array.from(converterFormats);
    setConverterRunning(true);
    setConverterProgress(5);
    setConverterCurrentItemId(items[0]?.id ?? null);
    void (async () => {
      const preparedItems: QueueItem[] = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        setConverterCurrentItemId(item.id);
        const outputDir = item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title));
        let missing = requestedFormats.filter((format) => !item.formats.includes(format));
        let generated: string[] = [];
        if (missing.includes("AZW3") && item.outputFiles?.some((file) => file.toLowerCase().endsWith(".epub"))) {
          const azw3 = await convertLocalEpubToAzw3(item.title, outputDir, item.outputFiles);
          if (azw3) {
            generated.push(azw3);
            missing = missing.filter((format) => format !== "AZW3");
          }
        }
        if (missing.length > 0) {
          generated = [...generated, ...await runDownload({
            serverUrl: appConfig.serverUrl,
            novel: { id: item.novelId, title: item.title, bundleKey: item.bundleKey, coverUrl: item.coverUrl },
            formats: missing,
            outputDir,
            range: item.preset === "range" && item.rangeStart && item.rangeEnd ? { start: item.rangeStart, end: item.rangeEnd } : undefined
          })];
        }
        const generatedFormats = generated
          .map((file) => file.split(".").pop()?.toUpperCase())
          .filter((format): format is DownloadFormat => downloadFormats.includes(format as DownloadFormat));
        const preparedItem: QueueItem = {
          ...item,
          formats: Array.from(new Set([...item.formats, ...requestedFormats, ...generatedFormats])),
          outputDir,
          outputFiles: Array.from(new Set([...(item.outputFiles ?? []), ...generated])),
          translate: item.translate || converterTranslate,
          audiobook: sendToKindle ? false : item.audiobook || converterAudiobook
        };
        preparedItems.push(preparedItem);
        setQueue((current) => current.map((entry) => entry.id === item.id ? {
          ...entry,
          ...preparedItem
        } : entry));
        const conversionShare = sendToKindle ? 90 : 100;
        setConverterProgress(Math.round(((index + 1) / items.length) * conversionShare));
      }
      refreshLocalLibrary();
      if (sendToKindle) {
        setConverterProgress(95);
        const result = await sendItemsToKindle(preparedItems);
        if (!result) throw new Error("Envio direto ao Kindle so esta disponivel no app desktop.");
        setConverterProgress(100);
        setToast(`${result.sentIds.length} livro(s) enviado(s) ao Kindle na ordem da fila.`);
      } else {
        setToast("Conversao concluida.");
      }
      setConverterRunning(false);
      setConverterCurrentItemId(null);
      setConverterOpen(false);
    })().catch((error: unknown) => {
      setConverterRunning(false);
      setConverterCurrentItemId(null);
      setToast(getErrorMessage(error, sendToKindle ? "Nao foi possivel enviar os itens ao Kindle." : "Nao foi possivel converter os itens."));
    });
  };

  const toggleConverterFormat = (format: DownloadFormat) => {
    if (kindleConnected) return;
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
    converterCurrentItemId,
    converterFormats,
    converterOpen,
    converterProgress,
    converterRunning,
    converterTranslate,
    openConverter,
    startConversion,
    toggleConverterFormat,
    toggleConverterAudiobook: () => {
      if (!kindleConnected) setConverterAudiobook((value) => !value);
    },
    toggleConverterTranslate: () => setConverterTranslate((value) => !value)
  };
}
