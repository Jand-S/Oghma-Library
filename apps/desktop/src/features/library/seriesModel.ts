import type { BookSeries, BookSnapshot, LibraryItem } from "../../core/types";
import { isImportKey } from "../../services/localFiles";
import { stackEditions, type LibraryStack } from "./libraryModel";

/** A book imported from the reader's own EPUB (`import:<sha>`), not from the catalog. */
export function isImported(item: LibraryItem) {
  return Boolean(item.novelId && isImportKey(item.novelId));
}

/** The series of an `import:` row snapshot, when it is well formed. */
export function seriesOfSnapshot(snapshot: BookSnapshot | null | undefined): BookSeries | undefined {
  const series = snapshot?.series;
  if (!series || typeof series.id !== "string" || !series.id || typeof series.name !== "string" || !series.name.trim()) {
    return undefined;
  }
  const volume = typeof series.volume === "number" && Number.isFinite(series.volume) ? series.volume : null;
  return { id: series.id, name: series.name, volume };
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

/** Reading order: volume number first (books without one last), then the title. */
export function compareVolumes(a: LibraryItem, b: LibraryItem) {
  const va = a.series?.volume ?? Infinity;
  const vb = b.series?.volume ?? Infinity;
  if (va !== vb) return va < vb ? -1 : 1;
  return collator.compare(a.title, b.title);
}

/** The volumes in reading order (a sorted copy). */
export function sortVolumes(items: LibraryItem[]): LibraryItem[] {
  return [...items].sort(compareVolumes);
}

/**
 * Cards of the library: the volumes of one series (same `series.id`) always become one card,
 * whose face is the first volume; other books stack by work with `editionKeysOf` (edition
 * stacks on) or stay alone (off). Books the reader separated stay alone either way. The card
 * keeps the place of the series' first book in the (filtered, sorted) list.
 */
export function stackLibrary(
  items: LibraryItem[],
  editionKeysOf: ((item: LibraryItem) => string[]) | null,
  separated: ReadonlySet<string> = new Set()
): LibraryStack[] {
  const keysOf = (item: LibraryItem): string[] => {
    if (separated.has(item.id)) return [];
    if (item.series) return [`s:${item.series.id}`];
    return editionKeysOf ? editionKeysOf(item) : [];
  };
  return stackEditions(items, keysOf).map((stack) => {
    const series = stack.main.series;
    if (!series || stack.items.length < 2) return stack;
    const volumes = sortVolumes(stack.items);
    return { key: `series:${series.id}`, main: volumes[0], items: volumes, series };
  });
}

/** Every volume of a series in the library (hidden ones left out), in reading order. */
export function volumesOf(library: LibraryItem[], seriesId: string): LibraryItem[] {
  return sortVolumes(library.filter((item) => !item.hidden && item.series?.id === seriesId));
}

/** The author shown for a series: the first volume that has one. */
export function seriesAuthor(volumes: LibraryItem[]) {
  return volumes.find((item) => item.author.trim())?.author ?? "";
}
