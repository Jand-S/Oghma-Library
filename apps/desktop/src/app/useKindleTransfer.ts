import { useEffect, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { KindleDeviceStatus, QueueItem } from "../core/types";
import { getErrorMessage, type BackendClient } from "../services/backendClient";
import { sanitizeFileName } from "../services/downloadManager";
import { sendItemsToKindle } from "../services/localFiles";

type KindleTransferArgs = {
  backend: BackendClient;
  kindleConnected: boolean;
  kindleStatus: KindleDeviceStatus | null;
  refreshLocalLibrary: () => void;
  selectedCompletedItems: QueueItem[];
  setQueue: Dispatch<SetStateAction<QueueItem[]>>;
  setToast: (message: string) => void;
};

export function useKindleTransfer({
  backend,
  kindleConnected,
  kindleStatus,
  refreshLocalLibrary,
  selectedCompletedItems,
  setQueue,
  setToast
}: KindleTransferArgs) {
  const [kindleModalOpen, setKindleModalOpen] = useState(false);
  const [kindleJobItems, setKindleJobItems] = useState<QueueItem[]>([]);
  const [kindleSending, setKindleSending] = useState(false);
  const [kindleCompleted, setKindleCompleted] = useState(false);
  const [kindleProgress, setKindleProgress] = useState(0);

  const kindleDisabledReason = useMemo(() => {
    if (!kindleConnected) return "Kindle desconectado.";
    if (selectedCompletedItems.length === 0) return "Selecione ao menos um livro concluido.";
    if (selectedCompletedItems.some((item) => !item.formats.includes("EPUB"))) {
      return "Somente livros com EPUB podem ser enviados ao Kindle.";
    }
    if (kindleStatus?.converterAvailable === false) return "Calibre/ebook-convert nao encontrado para converter EPUB em AZW3.";
    return undefined;
  }, [kindleConnected, kindleStatus?.converterAvailable, selectedCompletedItems]);

  const openKindleTransfer = () => {
    if (kindleDisabledReason) return;
    setKindleJobItems(selectedCompletedItems);
    setKindleProgress(0);
    setKindleCompleted(false);
    setKindleSending(false);
    setKindleModalOpen(true);
  };

  const closeKindleTransfer = () => {
    if (kindleSending) return;
    setKindleModalOpen(false);
    setKindleCompleted(false);
    setKindleProgress(0);
    setKindleJobItems([]);
  };

  const startKindleTransfer = () => {
    if (kindleJobItems.length === 0) return;
    setKindleProgress(0);
    setKindleCompleted(false);
    setKindleSending(true);
  };

  useEffect(() => {
    if (!kindleSending) return;
    if (kindleProgress >= 100) {
      let cancelled = false;
      void (async () => {
        const nativeResult = await sendItemsToKindle(kindleJobItems);
        return nativeResult ?? backend.sendToKindle(kindleJobItems);
      })()
        .then((result) => {
          if (cancelled) return;
          setKindleSending(false);
          setKindleCompleted(true);
          setQueue((items) => items.map((item) => result.sentIds.includes(item.id) ? {
            ...item,
            formats: item.formats.includes("AZW3") ? item.formats : [...item.formats, "AZW3"],
            outputFiles: item.outputFiles?.some((file) => file.toLowerCase().endsWith(".azw3"))
              ? item.outputFiles
              : [...(item.outputFiles ?? []), `${sanitizeFileName(item.title)}.azw3`]
          } : item));
          refreshLocalLibrary();
          setToast(`${result.sentIds.length} item(ns) convertidos para ${result.convertedFormat} e enviados ao Kindle.`);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setKindleSending(false);
          setToast(getErrorMessage(error, "Nao foi possivel concluir o envio para o Kindle."));
        });
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      setKindleProgress((value) => Math.min(100, value + 12 + Math.random() * 18));
    }, 140);
    return () => window.clearTimeout(timer);
  }, [backend, kindleJobItems, kindleProgress, kindleSending, refreshLocalLibrary, setQueue, setToast]);

  return {
    closeKindleTransfer,
    kindleCompleted,
    kindleDisabledReason,
    kindleJobItems,
    kindleModalOpen,
    kindleProgress,
    kindleSending,
    openKindleTransfer,
    startKindleTransfer
  };
}
