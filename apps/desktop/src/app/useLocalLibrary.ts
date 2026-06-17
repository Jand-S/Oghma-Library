import { useCallback, useEffect } from "react";
import type { AppConfig, LibraryItem, Novel, QueueItem } from "../core/types";
import { sanitizeFileName } from "../services/downloadManager";
import { listLocalLibrary, saveLocalFile } from "../services/localFiles";

type LocalLibraryArgs = {
  appConfig: AppConfig;
  loading: boolean;
  results: Novel[];
  setLibrary: (items: LibraryItem[]) => void;
};

export function useLocalLibrary({ appConfig, loading, results, setLibrary }: LocalLibraryArgs) {
  const refreshLocalLibrary = useCallback(() => {
    void listLocalLibrary(appConfig.outputPath)
      .then((items) => {
        if (!items) return;
        setLibrary(items.map((item) => {
          const formats = item.files
            .map((file) => file.split(".").pop()?.toUpperCase())
            .filter((format): format is "EPUB" | "PDF" | "TXT" => format === "EPUB" || format === "PDF" || format === "TXT");
          const known = results.find((novel) => sanitizeFileName(novel.title) === item.title || novel.title === item.title);
          return {
            id: `local-${item.outputDir}`,
            title: item.title,
            author: known?.author ?? "Desconhecido",
            format: formats[0] ?? "EPUB",
            formats,
            chapters: known?.chapters ?? 0,
            sizeMb: Math.max(1, Math.round(item.sizeBytes / 1024 / 1024)),
            coverClass: known?.coverClass ?? "cover-c",
            coverUrl: item.coverUrl,
            outputDir: item.outputDir,
            files: item.files,
            exportedAt: "Local"
          };
        }));
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
