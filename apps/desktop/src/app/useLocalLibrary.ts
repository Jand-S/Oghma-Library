import { useCallback, useEffect, useRef } from "react";
import type { AppConfig, DownloadFormat, LibraryItem, LibraryMeta, Novel } from "../core/types";
import { downloadFormats } from "../core/types";
import { sanitizeFileName } from "../services/downloadManager";
import {
  listLibraryMetadata,
  listLocalLibrary,
  novelMetaKey,
  prepareExportRoot,
  type LocalLibraryEntry
} from "../services/localFiles";

type LibraryUpdate = LibraryItem[] | ((current: LibraryItem[]) => LibraryItem[]);

type LocalLibraryArgs = {
  appConfig: AppConfig;
  loading: boolean;
  /** Current catalog results, used only to enrich local items (author, description…). */
  results: Novel[];
  setLibrary: (items: LibraryUpdate) => void;
};

const OUTPUT_PATH_DEBOUNCE_MS = 300;
const FOCUS_DEBOUNCE_MS = 400;
const FOCUS_MIN_INTERVAL_MS = 3000;

function normalizeTitle(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Catalog novel for a local entry. Entries with a manifest `novelId` match by id only
 * (a title match could be a different novel); legacy entries fall back to the title.
 */
export function findCatalogNovel(entry: LocalLibraryEntry, catalog: Novel[]): Novel | undefined {
  if (entry.novelId) return catalog.find((novel) => novel.id === entry.novelId);
  const exact = catalog.find((novel) =>
    novel.title === entry.title || sanitizeFileName(novel.title) === entry.folderName
  );
  if (exact) return exact;
  const wanted = new Set([normalizeTitle(entry.title), normalizeTitle(entry.folderName)]);
  return catalog.find((novel) =>
    wanted.has(normalizeTitle(novel.title)) || wanted.has(normalizeTitle(sanitizeFileName(novel.title)))
  );
}

function catalogFields(entry: LocalLibraryEntry, known: Novel | undefined) {
  return {
    novelId: entry.novelId ?? known?.id,
    author: known?.author ?? "",
    coverClass: known?.coverClass ?? "cover-c",
    bundleKey: known?.bundleKey,
    description: known?.description,
    sourceName: known?.sourceName
  };
}

function formatsOf(files: string[]): DownloadFormat[] {
  return files
    .map((file) => file.split(".").pop()?.toUpperCase())
    .filter((format): format is DownloadFormat => downloadFormats.includes(format as DownloadFormat));
}

/** Metadata row for an entry: the `novel:<id>` key wins over the legacy folder-path key. */
export function metaForEntry(entry: LocalLibraryEntry, metaByKey: Map<string, LibraryMeta>): LibraryMeta {
  return (entry.novelId ? metaByKey.get(novelMetaKey(entry.novelId)) : undefined)
    ?? metaByKey.get(entry.outputDir)
    ?? { key: entry.outputDir, favorite: false, readingStatus: "unread", tags: [], hidden: false };
}

export function buildLibraryItems(entries: LocalLibraryEntry[], metaRows: LibraryMeta[], catalog: Novel[]): LibraryItem[] {
  const metaByKey = new Map(metaRows.map((meta) => [meta.key, meta]));
  return entries.map((entry): LibraryItem => {
    const formats = formatsOf(entry.files);
    const known = findCatalogNovel(entry, catalog);
    const meta = metaForEntry(entry, metaByKey);
    return {
      id: `local-${entry.outputDir}`,
      ...catalogFields(entry, known),
      title: entry.title,
      format: formats[0] ?? "EPUB",
      formats,
      chapters: entry.chapterCount ?? known?.chapters ?? 0,
      sizeMb: Math.max(1, Math.round(entry.sizeBytes / 1024 / 1024)),
      sourceChars: entry.sourceChars,
      wordCount: entry.wordCount,
      analysisFormat: entry.analysisFormat,
      language: entry.language,
      translatedFrom: entry.sourceNovelId,
      translationProgress: entry.translationProgress,
      coverUrl: entry.coverUrl,
      outputDir: entry.outputDir,
      files: entry.files,
      exportedAt: entry.mtimeMs ? new Date(entry.mtimeMs).toISOString() : "Local",
      favorite: meta.favorite,
      readingStatus: meta.readingStatus,
      personalTags: meta.tags,
      hidden: meta.hidden
    };
  });
}

/** Re-applies catalog enrichment to already-listed items without touching metadata fields. */
export function enrichLibraryItems(items: LibraryItem[], entries: LocalLibraryEntry[], catalog: Novel[]): LibraryItem[] {
  const entryByDir = new Map(entries.map((entry) => [entry.outputDir, entry]));
  let changed = false;
  const next = items.map((item) => {
    const entry = item.outputDir ? entryByDir.get(item.outputDir) : undefined;
    if (!entry) return item;
    const known = findCatalogNovel(entry, catalog);
    if (!known) return item;
    const fields = catalogFields(entry, known);
    const chapters = entry.chapterCount ?? known.chapters ?? item.chapters;
    const same = item.novelId === fields.novelId && item.author === fields.author
      && item.coverClass === fields.coverClass && item.bundleKey === fields.bundleKey
      && item.description === fields.description && item.sourceName === fields.sourceName
      && item.chapters === chapters;
    if (same) return item;
    changed = true;
    return { ...item, ...fields, chapters };
  });
  return changed ? next : items;
}

/**
 * Keeps the local library in sync with the output folder. Scans on output path change
 * (debounced), when `loading` finishes, on window focus (debounced) and on `refresh()`.
 * Catalog `results` only enrich items; they never trigger a disk scan.
 */
export function useLocalLibrary({ appConfig, loading, results, setLibrary }: LocalLibraryArgs) {
  const outputPath = appConfig.outputPath;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const entriesRef = useRef<LocalLibraryEntry[]>([]);
  const requestSeq = useRef(0);
  const lastRefreshAt = useRef(0);
  const preparedRoot = useRef<string | null>(null);

  const refresh = useCallback(() => {
    const seq = ++requestSeq.current;
    lastRefreshAt.current = Date.now();
    if (preparedRoot.current !== outputPath) {
      preparedRoot.current = outputPath;
      void prepareExportRoot(outputPath).catch(() => undefined);
    }
    void Promise.all([listLocalLibrary(outputPath), listLibraryMetadata()])
      .then(([entries, metaRows]) => {
        if (!entries || seq !== requestSeq.current) return;
        entriesRef.current = entries;
        setLibrary(buildLibraryItems(entries, metaRows, resultsRef.current));
      })
      .catch(() => undefined);
  }, [outputPath, setLibrary]);

  // Output path changes (typing in Settings) and the end of boot loading.
  useEffect(() => {
    if (loading) return;
    const timer = window.setTimeout(refresh, lastRefreshAt.current === 0 ? 0 : OUTPUT_PATH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [loading, refresh]);

  // Files may change outside the app (Finder, another download): rescan on focus.
  useEffect(() => {
    let timer: number | undefined;
    const onFocus = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Date.now() - lastRefreshAt.current >= FOCUS_MIN_INTERVAL_MS) refresh();
      }, FOCUS_DEBOUNCE_MS);
    };
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearTimeout(timer);
    };
  }, [refresh]);

  // New catalog results only re-enrich what is already listed (no disk scan).
  useEffect(() => {
    if (entriesRef.current.length === 0) return;
    setLibrary((current) => enrichLibraryItems(current, entriesRef.current, results));
  }, [results, setLibrary]);

  return { refresh, refreshLocalLibrary: refresh };
}
