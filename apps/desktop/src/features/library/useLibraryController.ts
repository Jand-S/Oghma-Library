import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useConversionManager } from "../../app/useConversionManager";
import type { AppConfig, EnqueueResult, KindleDeviceStatus, LibraryItem, LibraryMeta, QueueItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { sanitizeFileName } from "../../services/downloadManager";
import type { DownloadQueue } from "../../services/downloadQueue";
import { deleteLibraryMetadata, deleteLocalLibraryFiles, joinPath, saveLibraryMetadata } from "../../services/localFiles";
import { libraryStrings } from "../../strings/library";
import { openOutputFolder } from "../downloads/useDownloadsController";
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
  notify
}: LibraryControllerArgs) {
  const browse = useLibraryBrowse(library);
  /** Books picked on the Kindle page, in send order. */
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);
  /** The batch the conversion manager works on (the Kindle send list, or one book to convert). */
  const [run, setRun] = useState<{ target: ConversionTarget; ids: string[] }>({ target: "kindle", ids: [] });
  const [startToken, setStartToken] = useState(0);

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
    }).filter((entry) => !entry.hidden));
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
      setLibrary((current) => current.filter((entry) => !keys.has(libraryMetaKey(entry))));
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

  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? ids.filter((itemId) => itemId !== id) : [...ids, id]));
  const removeSelectedLibraryItem = (id: string) =>
    setSelectedLibraryIds((ids) => ids.filter((itemId) => itemId !== id));

  return {
    library,
    /** Search, chips, sort and view mode of the Library page (shared with its PageHeader). */
    browse,
    kindleConnected,
    kindleStatus: kindleStatus ?? null,
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
