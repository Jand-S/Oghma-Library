import { useEffect, useState } from "react";
import type { AppConfig, DownloadFormat, DownloadJob, QueueItem } from "../core/types";
import { getErrorMessage } from "../services/backendClient";
import { convertInputFromQueueItem, type DownloadQueue } from "../services/downloadQueue";
import { sendItemsToKindle } from "../services/localFiles";
import { downloadsStrings } from "../strings/downloads";
import { libraryStrings } from "../strings/library";

type ConversionManagerArgs = {
  appConfig: AppConfig;
  kindleConnected: boolean;
  selectedCompletedItems: QueueItem[];
  queue: DownloadQueue;
  setToast: (message: string) => void;
};

/**
 * Library conversion / Kindle send. Each book becomes a `kind: "convert"` job in the
 * download queue (so it never runs concurrently with a download of the same folder);
 * this hook awaits the jobs and, for the Kindle, sends the settled folders.
 */
export function useConversionManager({
  appConfig,
  kindleConnected,
  selectedCompletedItems,
  queue,
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
    if (items.length === 0 || converterRunning) return;
    const sendToKindle = kindleConnected;
    const requestedFormats: DownloadFormat[] = sendToKindle ? ["AZW3"] : Array.from(converterFormats);
    setConverterRunning(true);
    setConverterProgress(5);
    setConverterCurrentItemId(items[0]?.id ?? null);
    void (async () => {
      // Enqueue every book first (queue order = selection order), then await them in order.
      const enqueued: Array<{ item: QueueItem; jobId: string }> = [];
      for (const item of items) {
        const outcome = queue.enqueue(convertInputFromQueueItem(item, appConfig, requestedFormats, {
          translate: item.translate || converterTranslate,
          audiobook: sendToKindle ? false : item.audiobook || converterAudiobook
        }));
        if (outcome.result === "added" && outcome.job) {
          enqueued.push({ item, jobId: outcome.job.id });
        } else if (outcome.result === "duplicate") {
          setToast(libraryStrings.conversionSkipped(item.title));
        } else {
          setToast(downloadsStrings.full);
          break;
        }
      }

      const share = sendToKindle ? 90 : 100;
      const settled: Array<{ item: QueueItem; job: DownloadJob }> = [];
      for (let index = 0; index < enqueued.length; index += 1) {
        const { item, jobId } = enqueued[index];
        setConverterCurrentItemId(item.id);
        const job = await queue.whenSettled(jobId);
        settled.push({ item, job });
        setConverterProgress(Math.max(5, Math.round(((index + 1) / enqueued.length) * share)));
      }

      const done = settled.filter(({ job }) => job.status === "done");
      const failed = settled.filter(({ job }) => job.status === "error");
      if (failed.length > 0) {
        const detail = failed[0].job.error;
        setToast(`${libraryStrings.conversionFailed(failed.length)}${detail ? ` ${detail}` : ""}`);
      }

      if (sendToKindle && done.length > 0) {
        setConverterProgress(95);
        const prepared: QueueItem[] = done.map(({ item, job }) => ({
          ...item,
          formats: Array.from(new Set([...item.formats, ...requestedFormats])),
          outputDir: job.finalDir ?? item.outputDir,
          outputFiles: job.outputFiles ?? item.outputFiles
        }));
        const result = await sendItemsToKindle(prepared);
        if (!result) throw new Error("Envio direto ao Kindle só está disponível no app desktop.");
        setConverterProgress(100);
        setToast(libraryStrings.kindleSent(result.sentIds.length));
      } else if (!sendToKindle && done.length > 0) {
        setConverterProgress(100);
        setToast(libraryStrings.conversionDone);
      }
      setConverterRunning(false);
      setConverterCurrentItemId(null);
      setConverterOpen(false);
    })().catch((error: unknown) => {
      setConverterRunning(false);
      setConverterCurrentItemId(null);
      setToast(getErrorMessage(error, sendToKindle ? "Não foi possível enviar os itens ao Kindle." : "Não foi possível converter os itens."));
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
