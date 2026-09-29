import { statusLabel } from "../../constants/ui";
import { defaultFilters } from "../../core/defaults";
import { cycleTagState, tagLabel } from "../../core/tagFilters";
import type { ContentRatingFilter, Filters, TagCatalogItem } from "../../core/types";
import { discoverStrings } from "../../strings/discover";

/** Chapter bounds that mean "no limit" (see `defaultFilters`). */
export const CHAPTERS_MIN_DEFAULT = 1;
export const CHAPTERS_MAX_DEFAULT = 999999;

export type TagState = "include" | "exclude" | "neutral";

export type ActiveFilter = {
  id: string;
  label: string;
  kind: "query" | "status" | "language" | "rating" | "chapters" | "include" | "exclude";
  /** Returns the filters without this one. */
  remove: (filters: Filters) => Filters;
};

export const statusOptions = [
  { value: "any", label: discoverStrings.statusAny },
  { value: "ongoing", label: statusLabel.ongoing },
  { value: "complete", label: statusLabel.complete },
  { value: "paused", label: statusLabel.paused }
];

export const languageOptions = [
  { value: "all", label: discoverStrings.languageAll },
  { value: "pt-br", label: "PT-BR" },
  { value: "en", label: "EN" }
];

export const ratingOptions: Array<{ value: ContentRatingFilter; label: string }> = [
  { value: "all", label: discoverStrings.ratingAll },
  { value: "safe", label: discoverStrings.ratingSafe },
  { value: "suggestive", label: discoverStrings.ratingSuggestive },
  { value: "erotic", label: discoverStrings.ratingErotic }
];

const optionLabel = (options: Array<{ value: string; label: string }>, value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

export function chapterBounds(filters: Filters) {
  return {
    min: filters.minChapters > CHAPTERS_MIN_DEFAULT ? filters.minChapters : null,
    max: filters.maxChapters < CHAPTERS_MAX_DEFAULT ? filters.maxChapters : null
  };
}

export function tagStateFor(filters: Pick<Filters, "includeTags" | "excludeTags">, key: string): TagState {
  if (filters.includeTags.includes(key)) return "include";
  if (filters.excludeTags.includes(key)) return "exclude";
  return "neutral";
}

/** neutral → include → exclude → neutral (same cycle as the old tag sheet). */
export function cycleTag(filters: Filters, key: string): Filters {
  return { ...filters, ...cycleTagState(filters, key) };
}

/** Filters the user set on top of the mandatory source, in display order. */
export function activeFilters(filters: Filters, catalog: TagCatalogItem[]): ActiveFilter[] {
  const items: ActiveFilter[] = [];
  const query = filters.query.trim();
  if (query) {
    items.push({ id: "query", kind: "query", label: discoverStrings.querySummary(query), remove: (f) => ({ ...f, query: "" }) });
  }
  if (filters.status !== "any") {
    items.push({ id: "status", kind: "status", label: optionLabel(statusOptions, filters.status), remove: (f) => ({ ...f, status: "any" }) });
  }
  if (filters.language !== "all") {
    items.push({ id: "language", kind: "language", label: optionLabel(languageOptions, filters.language), remove: (f) => ({ ...f, language: "all" }) });
  }
  if (filters.contentRating !== "all") {
    items.push({
      id: "rating",
      kind: "rating",
      label: `${discoverStrings.contentRating}: ${optionLabel(ratingOptions, filters.contentRating)}`,
      remove: (f) => ({ ...f, contentRating: "all" })
    });
  }
  const { min, max } = chapterBounds(filters);
  if (min != null || max != null) {
    items.push({
      id: "chapters",
      kind: "chapters",
      label: discoverStrings.chaptersSummary(min, max),
      remove: (f) => ({ ...f, minChapters: CHAPTERS_MIN_DEFAULT, maxChapters: CHAPTERS_MAX_DEFAULT })
    });
  }
  for (const key of filters.includeTags) {
    items.push({
      id: `include-${key}`,
      kind: "include",
      label: tagLabel(key, catalog),
      remove: (f) => ({ ...f, includeTags: f.includeTags.filter((item) => item !== key) })
    });
  }
  for (const key of filters.excludeTags) {
    items.push({
      id: `exclude-${key}`,
      kind: "exclude",
      label: tagLabel(key, catalog),
      remove: (f) => ({ ...f, excludeTags: f.excludeTags.filter((item) => item !== key) })
    });
  }
  return items;
}

/** How many drawer filters are set (the search query lives in the toolbar, so it is not counted). */
export function drawerFilterCount(filters: Filters) {
  const { min, max } = chapterBounds(filters);
  return (filters.status !== "any" ? 1 : 0)
    + (filters.language !== "all" ? 1 : 0)
    + (filters.contentRating !== "all" ? 1 : 0)
    + (min != null || max != null ? 1 : 0)
    + filters.includeTags.length
    + filters.excludeTags.length;
}

/** Resets everything except the (mandatory) source. */
export function clearedFilters(filters: Filters): Filters {
  return defaultFilters(filters.sourceId);
}
