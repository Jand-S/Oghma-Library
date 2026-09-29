import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useConversionManager } from "../../app/useConversionManager";
import type { AppConfig, EnqueueResult, LibraryItem, LibraryMeta, QueueItem } from "../../core/types";
import { getErrorMessage, type BackendClient } from "../../services/backendClient";
import { sanitizeFileName } from "../../services/downloadManager";
import type { DownloadQueue } from "../../services/downloadQueue";
import { deleteLibraryMetadata, deleteLocalLibraryFiles, joinPath, saveLibraryMetadata } from "../../services/localFiles";
import { libraryStrings } from "../../strings/library";
import { openOutputFolder } from "../downloads/useDownloadsController";

export function libraryToQueueItems(items: LibraryItem[]): QueueItem[] {
  return items.map((item) => ({
    id: item.id,
    novelId: item.novelId ?? item.id,
    title: item.title,
    coverClass: item.coverClass,
    coverUrl: item.coverUrl,
    bundleKey: item.bundleKey,
    preset: "all",
    rangeLabel: item.chapters ? `Todos os ${item.chapters.toLocaleString("pt-BR")} capitulos` : "Livro local",
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
  refreshLocalLibrary: () => void;
  notify: (message: string) => void;
};

/**
 * Whether "Baixar novamente" can work for a library item: it needs a novel id, which
 * comes from the folder's `.oghma-book.json` or from a catalog match.
 */
export function canRedownload(item: LibraryItem) {
  return Boolean(item.novelId);
}

/** Local library selection, metadata, deletion, conversion and re-download. */
export function useLibraryController({
  backend,
  appConfig,
  library,
  setLibrary,
  queue,
  enqueueDownload,
  kindleConnected,
  refreshLocalLibrary,
  notify
}: LibraryControllerArgs) {
  const [selectedLibraryIds, setSelectedLibraryIds] = useState<string[]>([]);

  const selectedCompletedItems = useMemo(
    () => selectedLibraryIds
      .map((id) => library.find((item) => item.id === id))
      .filter((item): item is LibraryItem => Boolean(item))
      .map((item) => libraryToQueueItems([item])[0]),
    [library, selectedLibraryIds]
  );

  const conversion = useConversionManager({ appConfig, kindleConnected, selectedCompletedItems, queue, setToast: notify });

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
      notify(getErrorMessage(error, "Nao foi possivel salvar os metadados da biblioteca."));
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
        notify(getErrorMessage(error, "Nao foi possivel salvar os metadados da biblioteca."));
      });
      notify(`${items.length} livro(s) removido(s) da biblioteca. Os arquivos foram mantidos.`);
      return;
    }
    const deletable = items.filter((item) => Boolean(item.outputDir));
    if (deletable.length === 0) {
      notify("Nao foi possivel localizar a pasta dos livros selecionados.");
      return;
    }
    void Promise.allSettled(deletable.map((item) => deleteLocalLibraryFiles(appConfig.outputPath, item.outputDir ?? "")))
      .then((results) => {
        const deletedItems = deletable.filter((_, index) => {
          const result = results[index];
          return result.status === "fulfilled" && result.value === true;
        });
        if (deletedItems.length === 0) {
          notify("Exclusao de arquivos so esta disponivel no app desktop.");
          return;
        }
        const deletedKeys = new Set(deletedItems.map(libraryMetaKey));
        const deletedIds = new Set(deletedItems.map((item) => item.id));
        setLibrary((current) => current.filter((entry) => !deletedKeys.has(libraryMetaKey(entry))));
        setSelectedLibraryIds((current) => current.filter((id) => !deletedIds.has(id)));
        void Promise.all(deletedItems.map((item) => deleteLibraryMetadata(libraryMetaKey(item)))).catch(() => undefined);
        const failedCount = items.length - deletedItems.length;
        notify(failedCount > 0
          ? `${deletedItems.length} livro(s) excluido(s); ${failedCount} nao puderam ser removidos.`
          : `${deletedItems.length} livro(s) e arquivos locais excluidos.`);
        refreshLocalLibrary();
      })
      .catch((error: unknown) => {
        notify(getErrorMessage(error, "Nao foi possivel excluir os arquivos locais."));
      });
  };

  const toggleLibrarySelect = (id: string) =>
    setSelectedLibraryIds((ids) => (ids.includes(id) ? ids.filter((itemId) => itemId !== id) : [...ids, id]));
  const removeSelectedLibraryItem = (id: string) =>
    setSelectedLibraryIds((ids) => ids.filter((itemId) => itemId !== id));

  return {
    library,
    kindleConnected,
    selectedLibraryIds,
    setSelectedLibraryIds,
    toggleLibrarySelect,
    removeSelectedLibraryItem,
    openLibraryItemFolder,
    updateLibraryMeta,
    deleteLibraryItems,
    redownloadItem,
    conversion
  };
}

export type LibraryController = ReturnType<typeof useLibraryController>;
