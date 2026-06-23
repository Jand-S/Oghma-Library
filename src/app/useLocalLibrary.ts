import { useCallback, useEffect } from "react";
import type { AppConfig, DownloadFormat, LibraryItem, LibraryMeta, Novel, QueueItem } from "../core/types";
import { downloadFormats } from "../core/types";
import { sanitizeFileName } from "../services/downloadManager";
import { listLibraryMetadata, listLocalLibrary, saveLocalFile } from "../services/localFiles";

type LocalLibraryArgs = {
  appConfig: AppConfig;
  loading: boolean;
  results: Novel[];
  setLibrary: (items: LibraryItem[]) => void;
};

export function useLocalLibrary({ appConfig, loading, results, setLibrary }: LocalLibraryArgs) {
  const refreshLocalLibrary = useCallback(() => {
    void Promise.all([listLocalLibrary(appConfig.outputPath), listLibraryMetadata()])
      .then(([items, metaRows]) => {
        if (!items) return;
        const metaByKey = new Map(metaRows.map((meta) => [meta.key, meta]));
        setLibrary(items.map((item) => {
          const formats = item.files
            .map((file) => file.split(".").pop()?.toUpperCase())
            .filter((format): format is DownloadFormat => downloadFormats.includes(format as DownloadFormat));
          const known = results.find((novel) => sanitizeFileName(novel.title) === item.title || novel.title === item.title);
          const meta: LibraryMeta = metaByKey.get(item.outputDir) ?? {
            key: item.outputDir,
            favorite: false,
            readingStatus: "unread",
            tags: [],
            hidden: false
          };
          return {
            id: `local-${item.outputDir}`,
            novelId: known?.id,
            title: item.title,
            author: known?.author ?? "",
            format: formats[0] ?? "EPUB",
            formats,
            chapters: known?.chapters ?? 0,
            sizeMb: Math.max(1, Math.round(item.sizeBytes / 1024 / 1024)),
            coverClass: known?.coverClass ?? "cover-c",
            coverUrl: item.coverUrl,
            bundleKey: known?.bundleKey,
            description: known?.description,
            sourceName: known?.sourceName,
            outputDir: item.outputDir,
            files: item.files,
            exportedAt: "Local",
            favorite: meta.favorite,
            readingStatus: meta.readingStatus,
            personalTags: meta.tags,
            hidden: meta.hidden
          };
        }).filter((item) => !item.hidden));
      })
      .catch(() => undefined);
  }, [appConfig.outputPath, results, setLibrary]);

  const saveCoverForItem = useCallback(async (item: QueueItem, outputDir: string) => {
    if (!item.coverUrl) return;
    const res = await fetch(item.coverUrl, { cache: "no-store" });
    if (!res.ok) return;
    const contentType = res.headers.get("content-type") ?? "";
    const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
    await saveLocalFile(outputDir, `cover.${ext}`, new Uint8Array(await res.arrayBuffer()));
  }, []);

  useEffect(() => {
    if (loading) return;
    refreshLocalLibrary();
  }, [loading, refreshLocalLibrary]);

  return { refreshLocalLibrary, saveCoverForItem };
}
