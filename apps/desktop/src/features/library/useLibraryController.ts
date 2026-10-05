import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { ToastTone } from "../../ui";
import { useConversionManager } from "../../app/useConversionManager";
import type { AppConfig, EnqueueResult, KindleDeviceStatus, LibraryItem, LibraryMeta, Novel, QueueItem } from "../../core/types";
import { shelfItem, snapshotOf } from "../../app/useLocalLibrary";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { sanitizeFileName } from "../../services/downloadManager";
import type { DownloadQueue } from "../../services/downloadQueue";
import {
  deleteLibraryMetadata,
  deleteLocalLibraryFiles,
  getICloudStatus,
  joinPath,
  novelMetaKey,
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
  notify: (message: string, tone?: ToastTone) => void;
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
      .filter((item): item is LibraryItem => Boolean(item) && item!.availability !== "shelf")
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

  // Shelf books have no files: never sent, converted or copied.
  const itemsById = (ids: string[]) => ids
    .map((id) => library.find((item) => item.id === id))
    .filter((item): item is LibraryItem => Boolean(item) && item!.availability !== "shelf");

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
    const formats = item.formats?.length ? item.formats : appConfig.defaultFormats?.length ? appConfig.defaultFormats : [item.format];
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

  /** Books of the catalog are keyed by the work (`novel:<id>`, synced); local-only books (translations,
   *  unknown folders) by their folder path. */
  const syncsAsNovel = (item: LibraryItem) => Boolean(item.novelId) && !item.language;
  const libraryMetaKey = (item: LibraryItem) =>
    syncsAsNovel(item) ? novelMetaKey(item.novelId!) : item.outputDir ?? item.id;
  const metadataFromItem = (item: LibraryItem): LibraryMeta => ({
    key: libraryMetaKey(item),
    favorite: Boolean(item.favorite),
    readingStatus: item.readingStatus ?? "unread",
    tags: item.personalTags ?? [],
    hidden: Boolean(item.hidden),
    rating: item.rating ?? null,
    onShelf: item.novelId && !item.language ? !item.hidden : false,
    addedAt: item.addedAt ?? null,
    snapshot: item.novelId && !item.language
      ? snapshotOf(item.novelId, undefined, {
        title: item.title,
        author: item.author,
        sourceId: item.sourceId,
        sourceName: item.sourceName,
        coverUrl: item.coverUrl,
        chapters: item.chapters,
        description: item.description
      })
      : null
  });

  const updateLibraryMeta = (item: LibraryItem, patch: Partial<Omit<LibraryMeta, "key">>) => {
    const nextMeta = { ...metadataFromItem(item), ...patch };
    // Showing or hiding a catalog book puts it back on (or takes it off) the shelf everywhere.
    if (patch.hidden !== undefined && patch.onShelf === undefined && syncsAsNovel(item)) nextMeta.onShelf = !patch.hidden;
    setLibrary((items) => items.map((entry) => {
      if (libraryMetaKey(entry) !== nextMeta.key) return entry;
      return {
        ...entry,
        favorite: nextMeta.favorite,
        readingStatus: nextMeta.readingStatus,
        rating: nextMeta.rating ?? undefined,
        personalTags: nextMeta.tags,
        hidden: nextMeta.hidden
      };
    }));
    if (nextMeta.hidden) {
      setSelectedLibraryIds((ids) => ids.filter((id) => id !== item.id));
    }
    void saveLibraryMetadata(nextMeta).catch((error: unknown) => {
      notify(getErrorMessage(error, libraryStrings.metaSaveFailed), "danger");
    });
  };

  /** The library book for a catalog novel (by id, aliases or the novel it was downloaded as). */
  const findByNovel = (novel: Pick<Novel, "id"> & { aliases?: string[] }) => library.find((item) =>
    item.novelId === novel.id || (item.novelId ? novel.aliases?.includes(item.novelId) : false));

  /**
   * Puts a catalog novel in the library without downloading it (the shelf). Already there:
   * only applies `patch` (e.g. "Já li" → Concluído).
   */
  const addToShelf = (novel: Novel, patch: Partial<Omit<LibraryMeta, "key">> = {}) => {
    const existing = findByNovel(novel);
    if (existing) {
      updateLibraryMeta(existing, { hidden: false, ...patch });
      if (existing.hidden) notify(libraryStrings.unhiddenToast(existing.title));
      return existing;
    }
    const now = Date.now();
    const meta: LibraryMeta = {
      key: novelMetaKey(novel.id),
      favorite: false,
      readingStatus: "unread",
      tags: [],
      hidden: false,
      rating: null,
      onShelf: true,
      addedAt: now,
      snapshot: snapshotOf(novel.id, novel),
      ...patch
    };
    const item = shelfItem(meta, novel.id, novel);
    setLibrary((current) => [...current.filter((entry) => entry.id !== item.id), item]);
    void saveLibraryMetadata(meta).catch((error: unknown) => {
      notify(getErrorMessage(error, libraryStrings.metaSaveFailed), "danger");
    });
    notify(libraryStrings.addedToShelf(novel.title), "success");
    return item;
  };

  /**
   * Points a shelf book at the same work in another source (its source left the catalog):
   * the old row becomes a tombstone and the new one keeps status, rating, favorite and tags.
   */
  const swapEdition = (item: LibraryItem, novel: Novel) => {
    if (!item.novelId || item.novelId === novel.id) return;
    const meta: LibraryMeta = {
      ...metadataFromItem(item),
      key: novelMetaKey(novel.id),
      hidden: false,
      onShelf: true,
      snapshot: snapshotOf(novel.id, novel)
    };
    const next = shelfItem(meta, novel.id, novel);
    setLibrary((current) => [...current.filter((entry) => entry.id !== item.id && entry.id !== next.id), next]);
    void deleteLibraryMetadata(novelMetaKey(item.novelId))
      .then(() => saveLibraryMetadata(meta))
      .catch((error: unknown) => notify(getErrorMessage(error, libraryStrings.metaSaveFailed), "danger"));
    notify(libraryStrings.editionSwapped(novel.sourceName), "success");
    return next;
  };

  /**
   * Removes books from the library. Shelf books leave everywhere (a tombstone the account
   * syncs). Downloaded books: `deleteFiles` false hides them on this device (files stay);
   * true deletes the folder, and `keepOnShelf` keeps the book in the library without files.
   */
  const deleteLibraryItems = (items: LibraryItem[], deleteFiles: boolean, keepOnShelf = false) => {
    if (items.length === 0) return;
    const shelfOnly = items.filter((item) => item.availability === "shelf");
    if (shelfOnly.length) {
      const shelfIds = new Set(shelfOnly.map((item) => item.id));
      setLibrary((current) => current.filter((entry) => !shelfIds.has(entry.id)));
      void Promise.all(shelfOnly.map((item) => deleteLibraryMetadata(libraryMetaKey(item)))).catch(() => undefined);
      notify(libraryStrings.removedFromShelf(shelfOnly.length));
      items = items.filter((item) => item.availability !== "shelf");
      if (items.length === 0) return;
    }
    const keys = new Set(items.map(libraryMetaKey));
    const ids = new Set(items.map((item) => item.id));
    if (!deleteFiles) {
      // Stays in state as hidden: the "Ocultos" chip lists it and it can be brought back.
      setLibrary((current) => current.map((entry) => keys.has(libraryMetaKey(entry)) ? { ...entry, hidden: true } : entry));
      setSelectedLibraryIds((current) => current.filter((id) => !ids.has(id)));
      // Catalog books leave the library on every computer (a tombstone that keeps what the reader
      // marked); the files stay on this disk. Local-only books are just hidden here.
      const removals = items.map((item) => syncsAsNovel(item)
        ? saveLibraryMetadata(metadataFromItem(item)).then(() => deleteLibraryMetadata(libraryMetaKey(item)))
        : saveLibraryMetadata({ ...metadataFromItem(item), hidden: true, onShelf: false }));
      void Promise.all(removals).catch((error: unknown) => {
        notify(getErrorMessage(error, libraryStrings.metaSaveFailed), "danger");
      });
      notify(libraryStrings.hiddenToast(items.length));
      return;
    }
    const deletable = items.filter((item) => Boolean(item.outputDir));
    if (deletable.length === 0) {
      notify(libraryStrings.folderNotFound);
      return;
    }
    // Saved before the folder goes: the shelf row needs the folder's novel id mapping.
    const keepRows = keepOnShelf
      ? deletable.filter((item) => item.novelId).map((item) => ({ ...metadataFromItem(item), hidden: false, onShelf: true }))
      : [];
    void Promise.all(keepRows.map((meta) => saveLibraryMetadata(meta)))
      .then(() => Promise.allSettled(deletable.map((item) => deleteLocalLibraryFiles(appConfig.outputPath, item.outputDir ?? ""))))
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
        const kept = new Set(keepRows.length ? deletedItems.filter((item) => item.novelId).map((item) => item.id) : []);
        void Promise.all(deletedItems.filter((item) => !kept.has(item.id)).map((item) => deleteLibraryMetadata(libraryMetaKey(item)))).catch(() => undefined);
        const failedCount = items.length - deletedItems.length;
        notify(failedCount > 0
          ? libraryStrings.deletedPartial(deletedItems.length, failedCount)
          : kept.size ? libraryStrings.filesDeletedKept(deletedItems.length) : libraryStrings.deletedToast(deletedItems.length));
        refreshLocalLibrary();
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, libraryStrings.deleteFailed), "danger");
      });
  };

  /** Brings a book removed from the library back (its files never left the disk). */
  const unhideLibraryItem = (item: LibraryItem) => {
    updateLibraryMeta(item, { hidden: false });
    notify(libraryStrings.unhiddenToast(item.title));
  };

  const visibleLibrary = useMemo(() => library.filter((item) => !item.hidden), [library]);
  /** Books with files on this computer: the only ones Kindle, iCloud and conversion can use. */
  const downloadedLibrary = useMemo(() => visibleLibrary.filter((item) => item.availability !== "shelf"), [visibleLibrary]);

  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? ids.filter((itemId) => itemId !== id) : [...ids, id]));
  const removeSelectedLibraryItem = (id: string) =>
    setSelectedLibraryIds((ids) => ids.filter((itemId) => itemId !== id));

  return {
    /** Books shown everywhere (counts, Início...): the hidden ones are left out; shelf books included. */
    library: visibleLibrary,
    /** Only the books with files on this computer (Kindle, iCloud, conversion, translation). */
    downloaded: downloadedLibrary,
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
    addToShelf,
    swapEdition,
    findByNovel,
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
