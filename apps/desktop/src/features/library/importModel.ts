import { workKey, type CatalogIndex } from "../../services/catalogIndex";
import type { ImportCommitItem, ImportPreview } from "../../services/importClient";

/** One file of the import sheet: the preview plus the fields the reader can edit. */
export type ImportDraft = {
  preview: ImportPreview;
  title: string;
  author: string;
  seriesName: string;
  /** Typed text ("2,5"); parsed by `parseVolume` on commit. */
  volume: string;
  /** The author came from a catalog novel named like the series (the EPUB had none). */
  authorFromCatalog: boolean;
  /** Commit error for this file (the sheet stays open to show it). */
  error: string | null;
};

export type ImportDraftFields = Pick<ImportDraft, "title" | "author" | "seriesName" | "volume">;

/**
 * Author of a catalog novel whose normalized title equals the series name ("Unsheathed" →
 * the "Unsheathed" novel's author). Empty when nothing matches or the match has no author.
 */
export function catalogAuthorForSeries(index: CatalogIndex | null | undefined, seriesName: string): string {
  const key = workKey(seriesName);
  if (!index || !key) return "";
  for (const { novel } of index.entries) {
    if (novel.author?.trim() && workKey(novel.title) === key) return novel.author.trim();
  }
  return "";
}

function formatVolume(volume: number | null | undefined): string {
  return volume == null ? "" : String(volume).replace(".", ",");
}

/** "2,5" or "2.5" → 2.5; empty → null; anything else (or more than one decimal) → undefined. */
export function parseVolume(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (!/^\d+(?:[.,]\d)?$/.test(trimmed)) return undefined;
  return Number(trimmed.replace(",", "."));
}

export function draftFromPreview(preview: ImportPreview, index: CatalogIndex | null | undefined): ImportDraft {
  const own = preview.author?.trim() ?? "";
  const suggested = own || !preview.series ? "" : catalogAuthorForSeries(index, preview.series.name);
  return {
    preview,
    title: preview.title,
    author: own || suggested,
    seriesName: preview.series?.name ?? "",
    volume: formatVolume(preview.series?.volume),
    authorFromCatalog: Boolean(suggested),
    error: null
  };
}

/** Files that "Importar N livros" writes: readable, not in the library yet, with a valid volume. */
export function isImportable(draft: ImportDraft): boolean {
  const { preview } = draft;
  return !preview.error && !preview.alreadyImported && parseVolume(draft.volume) !== undefined;
}

/** No cover in the EPUB and none from another volume: the app draws one. */
export function needsGeneratedCover(preview: ImportPreview): boolean {
  return !preview.coverDataUrl && !preview.coverFromLibrary;
}

/** What the typographic cover shows: series, "Volume N" and the title as subtitle. */
export function coverTextOf(draft: ImportDraft) {
  const series = draft.seriesName.trim();
  const title = draft.title.trim() || draft.preview.fileName.replace(/\.epub$/i, "");
  return { series: series || title, volume: series ? parseVolume(draft.volume) ?? null : null, subtitle: series ? title : "" };
}

export function commitItemOf(draft: ImportDraft, coverPng: Uint8Array | null): ImportCommitItem {
  const seriesName = draft.seriesName.trim();
  return {
    id: draft.preview.id,
    title: draft.title.trim() || draft.preview.title,
    author: draft.author.trim(),
    series: seriesName ? { name: seriesName, volume: parseVolume(draft.volume) ?? null } : null,
    coverPng: coverPng ? Array.from(coverPng) : null
  };
}
