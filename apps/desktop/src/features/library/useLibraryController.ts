import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useConversionManager } from "../../app/useConversionManager";
import type { AppConfig, EnqueueResult, KindleDeviceStatus, LibraryItem, LibraryMeta, QueueItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { sanitizeFileName } from "../../services/downloadManager";
import type { DownloadQueue } from "../../services/downloadQueue";
import {
  deleteLibraryMetadata,
  deleteLocalLibraryFiles,
  getICloudStatus,
  joinPath,
  revealInICloud,
  saveItemsToICloud,
  saveLibraryMetadata,
  sendItemsToKindleWireless
} from "../../services/localFiles";
import { libraryStrings } from "../../strings/library";
import type { ToastOptions } from "../../ui";
import { openOutputFolder } from "../downloads/useDownloadsController";
import { openExternal } from "../settings/appInfo";
import { readIntegrationPreferences, SEND_TO_KINDLE_URL } from "../settings/preferences";
import { useLibraryBrowse } from "./useLibraryBrowse";

export function libraryToQueueItems(items: LibraryItem[]): QueueItem[] {
  return items.map((item) => ({
    id: item.id,
    novelId: item.novelId ?? item.id,
    title: item.title,
    coverClass: item.coverClass,
    coverUrl: item.coverUrl,
    bundleKey: item.bundleKey,
    preset: "all",
    rangeLabel: item.chapters ? libraryStrings.allChapters(item.chapters) : libraryStrings.localBook,
    progress: 100,
    state: "done",
    chaptersTotal: item.chapters || 0,
    formats: item.formats?.length ? item.formats : [item.format],
    translate: false,
    audiobook: false,
    outputDir: item.outputDir,
    outputFiles: item.files
  }));
}

type LibraryControllerArgs = {
  backend: BackendClient;
  appConfig: AppConfig;
  library: LibraryItem[];
  setLibrary: Dispatch<SetStateAction<LibraryItem[]>>;
  queue: DownloadQueue;
  /** Enqueues a shaped download with added/duplicate/full feedback (downloads controller). */
  enqueueDownload: (item: QueueItem) => EnqueueResult;
  kindleConnected: boolean;
  /** Full device status (name, mount path) when App passes it; `kindleConnected` stays the source of truth. */
  kindleStatus?: KindleDeviceStatus | null;
  refreshLocalLibrary: () => void;
  notify: (message: string) => void;
  /** Rich toasts (with an action button) for the Mac integrations; falls back to `notify`. */
  toast?: (options: ToastOptions) => void;
};

/** What the conversion manager is set up to do: send to the Kindle, or convert in place. */
export type ConversionTarget = "kindle" | "convert";

/**
 * Whether "Baixar novamente" can work for a library item: it needs a novel id, which
 * comes from the folder's `.oghma-book.json` or from a catalog match.
 */
export function canRedownload(item: LibraryItem) {
  return Boolean(item.novelId);
}

/** Local library selection, metadata, deletion, conversion, Kindle send and re-download. */
export function useLibraryController({
  backend,
  appConfig,
  library,
  setLibrary,
  queue,
  enqueueDownload,
  kindleConnected,
  kindleStatus,
  refreshLocalLibrary,
  notify,
  toast
}: LibraryControllerArgs) {
  const browse = useLibraryBrowse(library);
  /** Books picked on the Kindle page, in send order. */
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  /** The batch the conversion manager works on (the Kindle send list, or one book to convert). */
  const [run, setRun] = useState<{ target: ConversionTarget; ids: string[] }>({ target: "kindle", ids: [] });
  const [startToken, setStartToken] = useState(0);
  /** iCloud Drive is on (macOS); false until checked and outside the desktop app. */
  const [icloudAvailable, setICloudAvailable] = useState(false);
  const [savingToICloud, setSavingToICloud] = useState(false);
  const showToast = (options: ToastOptions) => (toast ? toast(options) : notify(String(options.message)));

  useEffect(() => {
    let cancelled = false;
    void getICloudStatus()
      .then((status) => {
        if (!cancelled) setICloudAvailable(Boolean(status?.available));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const runItems = useMemo(
    () => run.ids
      .map((id) => library.find((item) => item.id === id))
      .filter((item): item is LibraryItem => Boolean(item))
      .map((item) => libraryToQueueItems([item])[0]),
    [library, run.ids]
  );

  const conversion = useConversionManager({
    appConfig,
    kindleConnected: kindleConnected && run.target === "kindle",
    selectedCompletedItems: runItems,
    queue,
    setToast: notify
  });

  // `sendToKindle` sets the batch and asks for a start; the start runs after the render
  // where the conversion manager already sees the new batch (so it only depends on the token).
  useEffect(() => {
    if (startToken > 0) conversion.startConversion();
  }, [startToken]);

  const ensureIdle = () => {
    if (!conversion.converterRunning) return true;
    notify(libraryStrings.busyConverting);
    return false;
  };

  /** Converts each book to AZW3 (as queue jobs) and copies them to the device, in order. */
  const sendToKindle = (ids: string[]) => {
    if (ids.length === 0 || !kindleConnected || !ensureIdle()) return false;
    setRun({ target: "kindle", ids });
    setStartToken((value) => value + 1);
    return true;
  };

  const itemsById = (ids: string[]) => ids
    .map((id) => library.find((item) => item.id === id))
    .filter((item): item is LibraryItem => Boolean(item));

  const offerSendToKindleInstall = () => showToast({
    message: libraryStrings.sendToKindleMissing,
    tone: "warning",
    duration: 0,
    action: { label: libraryStrings.installSendToKindle, onClick: () => void openExternal(SEND_TO_KINDLE_URL) }
  });

  /** Opens Amazon's Send to Kindle app with the books' EPUBs (Wi-Fi; no AZW3 conversion). */
  const sendToKindleWireless = (ids: string[]) => {
    const items = itemsById(ids);
    if (items.length === 0) return false;
    if (!kindleStatus?.wirelessAvailable) {
      offerSendToKindleInstall();
      return false;
    }
    void sendItemsToKindleWireless(libraryToQueueItems(items))
      .then((result) => {
        if (result) showToast({ message: libraryStrings.kindleWirelessOpened(result.openedIds.length), tone: "success" });
      })
      .catch((error: unknown) => showToast({ message: getErrorMessage(error, libraryStrings.kindleWirelessFailed), tone: "danger" }));
    return true;
  };

  /** Copies the books' EPUBs to iCloud Drive (folder from Ajustes → iCloud). */
  const saveToICloud = (ids: string[]) => {
    const items = itemsById(ids);
    if (items.length === 0 || savingToICloud) return false;
    const { icloudFolder } = readIntegrationPreferences();
    setSavingToICloud(true);
    void saveItemsToICloud(libraryToQueueItems(items), icloudFolder)
      .then((result) => {
        if (!result) return;
        const first = result.paths[0];
        showToast({
          message: libraryStrings.icloudSaved(result.savedIds.length, icloudFolder),
          tone: "success",
          action: first ? { label: libraryStrings.showInFinder, onClick: () => void revealInICloud(first).catch(() => undefined) } : undefined
        });
      })
      .catch((error: unknown) => showToast({ message: getErrorMessage(error, libraryStrings.icloudFailed), tone: "danger" }))
      .finally(() => setSavingToICloud(false));
    return true;
  };

  /** Points the conversion manager at the given books; the convert dialog then starts it. */
  const prepareConversion = (ids: string[]) => {
    if (ids.length === 0 || !ensureIdle()) return false;
    setRun({ target: "convert", ids });
    return true;
  };

  /**
   * Re-downloads a library book from the catalog (all chapters, same formats). The
   * export staging replaces the existing folder atomically once the download commits.
   */
  const redownloadItem = (item: LibraryItem) => {
    if (!item.novelId) {
      notify(libraryStrings.notInCatalog);
      return;
    }
    const formats = item.formats?.length ? item.formats : [item.format];
    void backend.createDownloads([{
      novelId: item.novelId,
      preset: "all",
      start: 1,
      end: Math.max(1, item.chapters || 1),
      formats,
      translate: false,
      audiobook: false
    }])
      .then(([queued]) => {
        if (!queued) throw new Error(libraryStrings.notInCatalog);
        enqueueDownload({ ...queued, coverUrl: queued.coverUrl ?? item.coverUrl });
      })
      .catch(() => notify(libraryStrings.notInCatalog));
  };

  const openLibraryItemFolder = (item: LibraryItem) =>
    openOutputFolder(item.outputDir ?? joinPath(appConfig.outputPath, sanitizeFileName(item.title)), `pasta de ${item.title}`, notify);

  const libraryMetaKey = (item: LibraryItem) => item.outputDir ?? item.id;
  const metadataFromItem = (item: LibraryItem): LibraryMeta => ({
    key: libraryMetaKey(item),
    favorite: Boolean(item.favorite),
    readingStatus: item.readingStatus ?? "unread",
    tags: item.personalTags ?? [],
    hidden: Boolean(item.hidden)
  });

  const updateLibraryMeta = (item: LibraryItem, patch: Partial<Omit<LibraryMeta, "key">>) => {
    const nextMeta = { ...metadataFromItem(item), ...patch };
    setLibrary((items) => items.map((entry) => {
      if (libraryMetaKey(entry) !== nextMeta.key) return entry;
      return {
        ...entry,
        favorite: nextMeta.favorite,
        readingStatus: nextMeta.readingStatus,
        personalTags: nextMeta.tags,
        hidden: nextMeta.hidden
      };
    }));
    if (nextMeta.hidden) {
      setSelectedLibraryIds((ids) => ids.filter((id) => id !== item.id));
    }
    void saveLibraryMetadata(nextMeta).catch((error: unknown) => {
      notify(getErrorMessage(error, libraryStrings.metaSaveFailed));
    });
  };

  const deleteLibraryItems = (items: LibraryItem[], deleteFiles: boolean) => {
    if (items.length === 0) return;
    const keys = new Set(items.map(libraryMetaKey));
    const ids = new Set(items.map((item) => item.id));
    if (!deleteFiles) {
      const hiddenRows = items.map((item) => ({ ...metadataFromItem(item), hidden: true }));
      // Stays in state as hidden: the "Ocultos" chip lists it and it can be brought back.
      setLibrary((current) => current.map((entry) => keys.has(libraryMetaKey(entry)) ? { ...entry, hidden: true } : entry));
      setSelectedLibraryIds((current) => current.filter((id) => !ids.has(id)));
      void Promise.all(hiddenRows.map((meta) => saveLibraryMetadata(meta))).catch((error: unknown) => {
        notify(getErrorMessage(error, libraryStrings.metaSaveFailed));
      });
      notify(libraryStrings.hiddenToast(items.length));
      return;
    }
    const deletable = items.filter((item) => Boolean(item.outputDir));
    if (deletable.length === 0) {
      notify(libraryStrings.folderNotFound);
      return;
    }
    void Promise.allSettled(deletable.map((item) => deleteLocalLibraryFiles(appConfig.outputPath, item.outputDir ?? "")))
      .then((results) => {
        const deletedItems = deletable.filter((_, index) => {
          const result = results[index];
          return result.status === "fulfilled" && result.value === true;
        });
        if (deletedItems.length === 0) {
          notify(libraryStrings.deleteDesktopOnly);
          return;
        }
        const deletedKeys = new Set(deletedItems.map(libraryMetaKey));
        const deletedIds = new Set(deletedItems.map((item) => item.id));
        setLibrary((current) => current.filter((entry) => !deletedKeys.has(libraryMetaKey(entry))));
        setSelectedLibraryIds((current) => current.filter((id) => !deletedIds.has(id)));
        void Promise.all(deletedItems.map((item) => deleteLibraryMetadata(libraryMetaKey(item)))).catch(() => undefined);
        const failedCount = items.length - deletedItems.length;
        notify(failedCount > 0
          ? libraryStrings.deletedPartial(deletedItems.length, failedCount)
          : libraryStrings.deletedToast(deletedItems.length));
        refreshLocalLibrary();
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, libraryStrings.deleteFailed));
      });
  };

  /** Brings a book removed from the library back (its files never left the disk). */
  const unhideLibraryItem = (item: LibraryItem) => {
    updateLibraryMeta(item, { hidden: false });
    notify(libraryStrings.unhiddenToast(item.title));
  };

  const visibleLibrary = useMemo(() => library.filter((item) => !item.hidden), [library]);

  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? ids.filter((itemId) => itemId !== id) : [...ids, id]));
  const removeSelectedLibraryItem = (id: string) =>
    setSelectedLibraryIds((ids) => ids.filter((itemId) => itemId !== id));

  return {
    /** Books shown everywhere (Kindle, counts...): the hidden ones are left out. */
    library: visibleLibrary,
    /** Every scanned book, hidden ones included (Library page: "Ocultos" chip and details). */
    allLibrary: library,
    unhideLibraryItem,
    /** Search, chips, sort and view mode of the Library page (shared with its PageHeader). */
    browse,
    kindleConnected,
    kindleStatus: kindleStatus ?? null,
    /** Wi-Fi sending through Amazon's app exists here (macOS), installed or not. */
    kindleWirelessSupported: Boolean(kindleStatus?.wirelessSupported),
    sendToKindleWireless,
    offerSendToKindleInstall,
    icloudAvailable,
    savingToICloud,
    saveToICloud,
    /** Library root; empty when the output folder is not configured. */
    outputPath: appConfig.outputPath,
    /** Rescans the output folder. */
    refresh: refreshLocalLibrary,
    selectedLibraryIds,
    setSelectedLibraryIds,
    toggleLibrarySelect,
    removeSelectedLibraryItem,
    openLibraryItemFolder,
    updateLibraryMeta,
    deleteLibraryItems,
    redownloadItem,
    /** Target and book ids of the current (or last) conversion batch, in order. */
    conversionTarget: run.target,
    conversionIds: run.ids,
    sendToKindle,
    prepareConversion,
    conversion
  };
}

export type LibraryController = ReturnType<typeof useLibraryController>;
