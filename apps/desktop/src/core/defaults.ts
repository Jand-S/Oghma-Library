import type {
  ChapterPreset,
  ChapterSelection,
  Filters,
  Novel
} from "./types";

export function defaultFilters(sourceId = "all"): Filters {
  return {
    query: "",
    sourceId,
    status: "any",
    language: "all",
    contentRating: "all",
    includeTags: [],
    excludeTags: [],
    onlyCovered: true,
    updatedOnly: false,
    minChapters: 1,
    maxChapters: 2500
  };
}

export function defaultSelection(novel: Novel): ChapterSelection {
  return {
    novelId: novel.id,
    preset: "all",
    start: 1,
    end: novel.chapters,
    formats: ["EPUB"],
    translate: false,
    audiobook: false
  };
}

export function selectionLabel(selection: ChapterSelection, max: number) {
  const labels: Record<ChapterPreset, string> = {
    all: `Todos os ${max.toLocaleString("pt-BR")} capitulos`,
    range: `Capitulos ${Math.max(1, selection.start)}-${Math.min(selection.end, max)}`
  };
  return labels[selection.preset];
}

export function estimateChapters(selection: ChapterSelection, max: number) {
  if (selection.preset === "all") return max;
  return Math.max(1, Math.min(selection.end, max) - Math.max(1, selection.start) + 1);
}
