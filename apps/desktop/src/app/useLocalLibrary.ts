import { useCallback, useEffect, useRef } from "react";
import type { AppConfig, BookSnapshot, DownloadFormat, LibraryItem, LibraryMeta, Novel } from "../core/types";
import { downloadFormats } from "../core/types";
import { sanitizeFileName } from "../services/downloadManager";
import {
  listLibraryMetadata,
  listLocalLibrary,
  novelMetaKey,
  prepareExportRoot,
  saveLibraryMetaRows,
  type LocalLibraryEntry
} from "../services/localFiles";

type LibraryUpdate = LibraryItem[] | ((current: LibraryItem[]) => LibraryItem[]);

type LocalLibraryArgs = {
  appConfig: AppConfig;
  loading: boolean;
  /** Current catalog results, used only to enrich local items (author, description…). */
  results: Novel[];
  setLibrary: (items: LibraryUpdate) => void;
  /** Rows were written by the library itself (downloads joining the shelf): the sync pushes them. */
  onMetaChanged?: () => void;
};

function mergeRows(rows: LibraryMeta[], additions: LibraryMeta[]): LibraryMeta[] {
  const keys = new Set(additions.map((row) => row.key));
  return [...rows.filter((row) => !keys.has(row.key)), ...additions];
}

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
  // An old id still matches after the site moved the novel (the catalog lists it under `aliases`).
  if (entry.novelId) {
    const id = entry.novelId;
    return catalog.find((novel) => novel.id === id) ?? catalog.find((novel) => novel.aliases?.includes(id));
  }
  const exact = catalog.find((novel) =>
    novel.title === entry.title || sanitizeFileName(novel.title) === entry.folderName
  );
  if (exact) return exact;
  const wanted = new Set([normalizeTitle(entry.title), normalizeTitle(entry.folderName)]);
  return catalog.find((novel) =>
    wanted.has(normalizeTitle(novel.title)) || wanted.has(normalizeTitle(sanitizeFileName(novel.title)))
  );
}

/** How many chapters the catalog has beyond a whole-novel download (0 for ranges and translations). */
export function newChaptersFor(entry: LocalLibraryEntry, known: Novel | undefined): number {
  if (!known || entry.partialRange || entry.language || entry.chapterCount === undefined) return 0;
  return Math.max(0, known.chapters - entry.chapterCount);
}

function catalogFields(entry: LocalLibraryEntry, known: Novel | undefined) {
  return {
    newChapters: newChaptersFor(entry, known),
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
  const live = (meta: LibraryMeta | undefined) => (meta && !meta.deletedAt ? meta : undefined);
  return live(entry.novelId ? metaByKey.get(novelMetaKey(entry.novelId)) : undefined)
    ?? live(metaByKey.get(entry.outputDir))
    ?? { key: entry.outputDir, favorite: false, readingStatus: "unread", tags: [], hidden: false };
}

function personalFields(meta: LibraryMeta) {
  return {
    favorite: meta.favorite,
    readingStatus: meta.readingStatus,
    rating: meta.rating ?? undefined,
    personalTags: meta.tags,
    hidden: meta.hidden,
    addedAt: meta.addedAt ?? undefined
  };
}

/** Novel id of a `novel:<id>` key, or undefined for folder-path keys. */
export function novelIdOfKey(key: string): string | undefined {
  return key.startsWith("novel:") ? key.slice("novel:".length) : undefined;
}

/** Catalog novel for an id, following the moved-novel aliases. */
export function catalogNovelById(catalog: Novel[], id: string): Novel | undefined {
  return catalog.find((novel) => novel.id === id) ?? catalog.find((novel) => novel.aliases?.includes(id));
}

/** What the library keeps of a catalog novel (or of a downloaded book) to show it later without either. */
export function snapshotOf(novelId: string, known: Novel | undefined, fallback?: Partial<BookSnapshot>): BookSnapshot {
  return {
    novelId,
    title: known?.title ?? fallback?.title ?? novelId,
    author: known?.author || fallback?.author || undefined,
    sourceId: known?.sourceId ?? fallback?.sourceId,
    sourceName: known?.sourceName ?? fallback?.sourceName,
    // Local asset URLs (asset://) only make sense on this computer.
    coverUrl: known?.coverUrl ?? (fallback?.coverUrl?.startsWith("http") ? fallback.coverUrl : undefined),
    chapters: known?.chapters ?? fallback?.chapters,
    description: known?.description ?? fallback?.description
  };
}

/** A library book without files: from the catalog when it is still published, else from the snapshot. */
export function shelfItem(meta: LibraryMeta, novelId: string, known: Novel | undefined): LibraryItem {
  const snap = meta.snapshot ?? undefined;
  return {
    id: `shelf-${novelId}`,
    novelId: known?.id ?? novelId,
    title: known?.title ?? snap?.title ?? novelId,
    author: known?.author ?? snap?.author ?? "",
    format: "EPUB",
    formats: [],
    chapters: known?.chapters ?? snap?.chapters ?? 0,
    sizeMb: 0,
    coverClass: known?.coverClass ?? "cover-c",
    coverUrl: known?.coverUrl ?? snap?.coverUrl,
    bundleKey: known?.bundleKey,
    description: known?.description ?? snap?.description,
    sourceId: known?.sourceId ?? snap?.sourceId,
    sourceName: known?.sourceName ?? snap?.sourceName,
    exportedAt: meta.addedAt ? new Date(meta.addedAt).toISOString() : "Local",
    availability: "shelf",
    unavailable: !known,
    ...personalFields(meta)
  };
}

export function buildLibraryItems(entries: LocalLibraryEntry[], metaRows: LibraryMeta[], catalog: Novel[]): LibraryItem[] {
  const metaByKey = new Map(metaRows.map((meta) => [meta.key, meta]));
  const onDisk = new Set<string>();
  const local = entries.map((entry): LibraryItem => {
    const formats = formatsOf(entry.files);
    const known = findCatalogNovel(entry, catalog);
    const meta = metaForEntry(entry, metaByKey);
    const fields = catalogFields(entry, known);
    if (entry.novelId) onDisk.add(entry.novelId);
    if (fields.novelId) onDisk.add(fields.novelId);
    if (known) onDisk.add(known.id);
    return {
      id: `local-${entry.outputDir}`,
      ...fields,
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
      availability: "local",
      sourceId: known?.sourceId,
      ...personalFields(meta)
    };
  });
  const shelf: LibraryItem[] = [];
  for (const meta of metaRows) {
    const novelId = novelIdOfKey(meta.key);
    if (!novelId || !meta.onShelf || meta.deletedAt || onDisk.has(novelId)) continue;
    const known = catalogNovelById(catalog, novelId);
    if (known && onDisk.has(known.id)) continue;
    shelf.push(shelfItem(meta, novelId, known));
  }
  return [...local, ...shelf];
}

/**
 * Downloaded books that are not in the library rows yet (downloaded before the shelf existed,
 * or on this device only): they join the library with a snapshot. A book removed on purpose
 * (tombstone) only comes back when its files are newer than the removal (downloaded again).
 */
export function shelfAdditions(entries: LocalLibraryEntry[], metaRows: LibraryMeta[], catalog: Novel[], now = Date.now()): LibraryMeta[] {
  const metaByKey = new Map(metaRows.map((meta) => [meta.key, meta]));
  const out: LibraryMeta[] = [];
  for (const entry of entries) {
    if (entry.language) continue; // translations are this computer's own books
    const known = findCatalogNovel(entry, catalog);
    const novelId = entry.novelId ?? known?.id;
    if (!novelId) continue;
    const key = novelMetaKey(novelId);
    const row = metaByKey.get(key);
    const legacy = metaByKey.get(entry.outputDir);
    if (row && !row.deletedAt && (row.onShelf || row.hidden)) continue;
    if (row?.deletedAt && (entry.mtimeMs ?? 0) <= row.deletedAt) continue;
    if (!row && legacy?.hidden) continue;
    const base = row && !row.deletedAt ? row : legacy && !legacy.deletedAt ? legacy : undefined;
    out.push({
      key,
      favorite: base?.favorite ?? false,
      readingStatus: base?.readingStatus ?? "unread",
      tags: base?.tags ?? [],
      hidden: false,
      rating: base?.rating ?? null,
      onShelf: true,
      addedAt: base?.addedAt ?? entry.mtimeMs ?? now,
      snapshot: snapshotOf(novelId, known, { title: entry.title, coverUrl: entry.coverUrl, chapters: entry.chapterCount })
    });
  }
  return out;
}

/** Re-applies catalog enrichment to already-listed items without touching metadata fields. */
export function enrichLibraryItems(items: LibraryItem[], entries: LocalLibraryEntry[], catalog: Novel[]): LibraryItem[] {
  const entryByDir = new Map(entries.map((entry) => [entry.outputDir, entry]));
  let changed = false;
  const next = items.map((item) => {
    if (item.availability === "shelf" && item.novelId) {
      const known = catalogNovelById(catalog, item.novelId);
      if (!known) return item;
      const same = !item.unavailable && item.title === known.title && item.coverUrl === (known.coverUrl ?? item.coverUrl)
        && item.chapters === known.chapters && item.sourceName === known.sourceName && item.bundleKey === known.bundleKey;
      if (same) return item;
      changed = true;
      return {
        ...item,
        novelId: known.id,
        title: known.title,
        author: known.author,
        coverUrl: known.coverUrl ?? item.coverUrl,
        coverClass: known.coverClass,
        chapters: known.chapters,
        description: known.description,
        sourceId: known.sourceId,
        sourceName: known.sourceName,
        bundleKey: known.bundleKey,
        unavailable: false
      };
    }
    const entry = item.outputDir ? entryByDir.get(item.outputDir) : undefined;
    if (!entry) return item;
    const known = findCatalogNovel(entry, catalog);
    if (!known) return item;
    const fields = catalogFields(entry, known);
    const chapters = entry.chapterCount ?? known.chapters ?? item.chapters;
    const same = item.novelId === fields.novelId && item.author === fields.author
      && item.coverClass === fields.coverClass && item.bundleKey === fields.bundleKey
      && item.description === fields.description && item.sourceName === fields.sourceName
      && item.chapters === chapters && item.newChapters === fields.newChapters;
    if (same) return item;
    changed = true;
    return { ...item, ...fields, chapters };
  });
  return changed ? next : items;
}

/**
 * Keeps the local library in sync with the output folder. Scans on output path change
 * (debounced), when `loading` finishes, on window focus (debounced) and on `refresh()`.
 * Catalog `results` only enrich items; only the first catalog triggers a scan (shelf books
 * and untracked downloads need it). The library is the files on disk plus the shelf rows.
 */
export function useLocalLibrary({ appConfig, loading, results, setLibrary, onMetaChanged }: LocalLibraryArgs) {
  const outputPath = appConfig.outputPath;
  const resultsRef = useRef(results);
  resultsRef.current = results;
  const entriesRef = useRef<LocalLibraryEntry[]>([]);
  const metaRowsRef = useRef<LibraryMeta[]>([]);
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
        const catalog = resultsRef.current;
        const additions = catalog.length ? shelfAdditions(entries, metaRows, catalog) : [];
        const rows = additions.length ? mergeRows(metaRows, additions) : metaRows;
        metaRowsRef.current = rows;
        setLibrary(buildLibraryItems(entries, rows, catalog));
        if (additions.length) void saveLibraryMetaRows(additions).then(() => onMetaChanged?.()).catch(() => undefined);
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

  // New catalog results re-enrich what is already listed (no disk scan); the first catalog
  // also brings the shelf books in (they need it to resolve) and adds untracked downloads.
  const hadCatalog = useRef(false);
  useEffect(() => {
    if (!results.length) return;
    if (!hadCatalog.current) {
      hadCatalog.current = true;
      if (lastRefreshAt.current > 0) {
        refresh();
        return;
      }
    }
    if (entriesRef.current.length === 0 && metaRowsRef.current.length === 0) return;
    setLibrary((current) => enrichLibraryItems(current, entriesRef.current, results));
  }, [refresh, results, setLibrary]);

  return { refresh, refreshLocalLibrary: refresh };
}
