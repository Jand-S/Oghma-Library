import type { DownloadFormat, DownloadJob, LibraryItem } from "../../core/types";
import { downloadFormats } from "../../core/types";
import { libraryStrings } from "../../strings/library";

export type LibrarySort = "recent" | "title" | "size";
export type LibraryViewMode = "grid" | "list";

export type LibraryFilters = {
  query: string;
  formats: ReadonlySet<DownloadFormat>;
  favoritesOnly: boolean;
  translatedOnly?: boolean;
  sort: LibrarySort;
};

/** Books produced by the translation screen. */
export function isTranslated(item: LibraryItem) {
  return Boolean(item.language) || item.analysisFormat === "translation";
}

export function formatsOf(item: LibraryItem): DownloadFormat[] {
  return item.formats?.length ? item.formats : [item.format];
}

/** "EPUB · AZW3" */
export function formatSummary(item: LibraryItem) {
  return formatsOf(item).join(" · ");
}

/** Milliseconds since epoch when `exportedAt` is a real date, otherwise NaN. */
export function itemTimestamp(item: LibraryItem) {
  return Date.parse(item.exportedAt);
}

/** Short pt-BR date ("29 de set. de 2026"), the raw label for legacy values, or a dash. */
export function formatDownloadedAt(item: LibraryItem) {
  const timestamp = itemTimestamp(item);
  if (Number.isFinite(timestamp)) {
    return new Date(timestamp).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
  }
  const label = item.exportedAt?.trim();
  return label && label !== "Local" ? label : libraryStrings.unknownDate;
}

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Formats present in the library, in the canonical order. */
export function availableFormats(library: LibraryItem[]): DownloadFormat[] {
  const present = new Set(library.flatMap(formatsOf));
  return downloadFormats.filter((format) => present.has(format));
}

export function matchesQuery(item: LibraryItem, query: string) {
  const needle = normalize(query.trim());
  if (!needle) return true;
  return [item.title, item.author, item.sourceName ?? "", ...(item.personalTags ?? [])]
    .some((value) => normalize(value).includes(needle));
}

export function filterLibrary(library: LibraryItem[], filters: LibraryFilters): LibraryItem[] {
  const filtered = library
    .map((item, index) => ({ item, index }))
    .filter(({ item }) =>
      matchesQuery(item, filters.query)
      && (!filters.favoritesOnly || Boolean(item.favorite))
      && (!filters.translatedOnly || isTranslated(item))
      && (filters.formats.size === 0 || formatsOf(item).some((format) => filters.formats.has(format))));

  const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
  filtered.sort((a, b) => {
    if (filters.sort === "title") return collator.compare(a.item.title, b.item.title) || a.index - b.index;
    if (filters.sort === "size") return b.item.sizeMb - a.item.sizeMb || a.index - b.index;
    // Recent first; items without a real date keep the scan order after dated ones.
    const ta = itemTimestamp(a.item);
    const tb = itemTimestamp(b.item);
    const va = Number.isFinite(ta) ? ta : -Infinity;
    const vb = Number.isFinite(tb) ? tb : -Infinity;
    if (va !== vb) return vb - va;
    return a.index - b.index;
  });
  return filtered.map(({ item }) => item);
}

/** A queue job that is rewriting this book right now or is waiting to. */
export type BookJobState = {
  kind: DownloadJob["kind"];
  phase: "active" | "queued";
  percent: number;
};

export type JobLookup = { activeJob: DownloadJob | null; queuedJobs: DownloadJob[] };

export function bookJobState(item: LibraryItem, jobs: JobLookup): BookJobState | null {
  const novelId = item.novelId ?? item.id;
  const active = jobs.activeJob;
  if (active && active.novelId === novelId && active.status !== "canceled") {
    return { kind: active.kind, phase: "active", percent: active.progress.percent };
  }
  const queued = jobs.queuedJobs.find((job) => job.novelId === novelId);
  return queued ? { kind: queued.kind, phase: "queued", percent: 0 } : null;
}

/** Badge text for a book being rewritten by the queue. */
export function jobLabel(state: BookJobState) {
  if (state.phase === "queued") return libraryStrings.waitingInQueue;
  if (state.kind === "convert") return state.percent > 0 ? libraryStrings.convertingPercent(state.percent) : libraryStrings.converting;
  return state.percent > 0 ? libraryStrings.updatingPercent(state.percent) : libraryStrings.updating;
}
