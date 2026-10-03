// In-memory search index over every loaded catalog (all sources at once).
//
// Built once per catalog load instead of rebuilding every Novel and re-canonicalizing every
// tag on each keystroke. The text search looks at title, author, synopsis and tag labels,
// ignoring accents and case, so "cultivo" finds the novels tagged Cultivo and "acao" finds
// "Ação". With a query the results are ranked (title > tag > author > synopsis).
import { canonicalTagText, matchesContentRating, normalizeSearchText, tagKeysForNovel } from "../core/tagFilters";
import type { Filters, Novel } from "../core/types";

type Entry = {
  novel: Novel;
  tagKeys: Set<string>;
  title: string;
  author: string;
  tags: string;
  description: string;
};

export type CatalogIndex = {
  entries: Entry[];
  byId: Map<string, Novel>;
};

export function buildCatalogIndex(novels: Iterable<Novel>): CatalogIndex {
  const entries: Entry[] = [];
  const byId = new Map<string, Novel>();
  for (const novel of novels) {
    const keys = tagKeysForNovel(novel);
    entries.push({
      novel,
      tagKeys: new Set(keys),
      title: ` ${normalizeSearchText(novel.title)}`,
      author: ` ${normalizeSearchText(novel.author)}`,
      tags: ` ${normalizeSearchText([...novel.tags, ...keys.flatMap(canonicalTagText)].join(" "))}`,
      description: ` ${normalizeSearchText(novel.description)}`
    });
    byId.set(novel.id, novel);
  }
  return { entries, byId };
}

/** `token` starts a word of `field` (fields are normalized and space-separated, with a leading
 *  space added at build time): "acao" finds "Ação" but not "Fundação", "cultiv" finds "Cultivo". */
function hasWord(field: string, token: string): boolean {
  return field.includes(` ${token}`);
}

/** Relevance of `entry` for every token (0 when some token matches nowhere). */
function score(entry: Entry, tokens: string[], phrase: string): number {
  let total = 0;
  for (const token of tokens) {
    const s = (hasWord(entry.title, token) ? 8 : 0)
      + (hasWord(entry.tags, token) ? 4 : 0)
      + (hasWord(entry.author, token) ? 3 : 0)
      + (hasWord(entry.description, token) ? 1 : 0);
    if (s === 0) return 0;
    total += s;
  }
  if (phrase && hasWord(entry.title, phrase)) total += 10;
  if (phrase && entry.title.startsWith(` ${phrase}`)) total += 5;
  return total;
}

/**
 * Novels matching `filters`. `sourceIds` limits "all" to the enabled sources; a specific
 * `filters.sourceId` wins over it. Without a query the catalog order is kept (the grid sorts).
 */
export function searchCatalog(index: CatalogIndex, filters: Filters, sourceIds?: readonly string[]): Novel[] {
  const phrase = normalizeSearchText(filters.query);
  const tokens = phrase ? phrase.split(" ") : [];
  const allowed = filters.sourceId !== "all" ? new Set([filters.sourceId]) : sourceIds ? new Set(sourceIds) : null;
  const ranked: Array<{ novel: Novel; score: number }> = [];
  for (const entry of index.entries) {
    const { novel } = entry;
    if (allowed && !allowed.has(novel.sourceId)) continue;
    if (filters.status !== "any" && novel.status !== filters.status) continue;
    if (filters.language !== "all" && novel.language.toLowerCase() !== filters.language) continue;
    if (novel.chapters < filters.minChapters || novel.chapters > filters.maxChapters) continue;
    if (!filters.includeTags.every((key) => entry.tagKeys.has(key))) continue;
    if (filters.excludeTags.some((key) => entry.tagKeys.has(key))) continue;
    if (!matchesContentRating(novel, filters.contentRating)) continue;
    const s = tokens.length ? score(entry, tokens, phrase) : 1;
    if (s > 0) ranked.push({ novel, score: s });
  }
  if (tokens.length) ranked.sort((a, b) => b.score - a.score);
  return ranked.map((item) => item.novel);
}

// ---------------------------------------------------------------- discovery helpers

/** Same work, any source: title without accents, case, and edition suffixes like "(Novel)" or "[WN]". */
export function workKey(title: string): string {
  return normalizeSearchText(title.replace(/[([][^)\]]*[)\]]/g, " "));
}

/** Tags that describe the story (genres and themes), not the format or the origin. */
function storyTags(keys: Iterable<string>): Set<string> {
  return new Set([...keys].filter((key) => !key.startsWith("format.")));
}

/**
 * The same work published by other sources ("Também em: Central Novel, RoliaScan"),
 * matched by title. Sorted by chapter count (the most complete edition first).
 */
export function editionsOf(index: CatalogIndex, novel: Novel): Novel[] {
  const key = workKey(novel.title);
  if (!key) return [];
  return index.entries
    .filter((entry) => entry.novel.id !== novel.id && entry.novel.sourceId !== novel.sourceId && workKey(entry.novel.title) === key)
    .map((entry) => entry.novel)
    .sort((a, b) => b.chapters - a.chapters);
}

/**
 * Novels that share the most story tags with `seeds` (Jaccard similarity), skipping the
 * seeds, their other editions and anything in `exclude`. Same language as the seeds counts a
 * little extra, so a Portuguese reader gets Portuguese suggestions first.
 */
export function similarNovels(
  index: CatalogIndex,
  seeds: Novel[],
  options: { limit?: number; exclude?: ReadonlySet<string>; sourceIds?: readonly string[] } = {}
): Novel[] {
  const limit = options.limit ?? 8;
  if (!seeds.length) return [];
  const seedEntries = seeds.map((seed) => index.entries.find((entry) => entry.novel.id === seed.id)).filter(Boolean) as Entry[];
  const seedTags = seedEntries.map((entry) => storyTags(entry.tagKeys));
  const seedWorks = new Set(seeds.map((seed) => workKey(seed.title)));
  const languages = new Set(seeds.map((seed) => seed.language.toLowerCase()));
  const allowed = options.sourceIds ? new Set(options.sourceIds) : null;
  const scored: Array<{ novel: Novel; score: number }> = [];
  for (const entry of index.entries) {
    const { novel } = entry;
    if (options.exclude?.has(novel.id) || seedWorks.has(workKey(novel.title))) continue;
    if (allowed && !allowed.has(novel.sourceId)) continue;
    const tags = storyTags(entry.tagKeys);
    if (tags.size === 0) continue;
    let best = 0;
    for (const seed of seedTags) {
      let shared = 0;
      for (const tag of tags) if (seed.has(tag)) shared += 1;
      if (shared < 2) continue;
      best = Math.max(best, shared / (seed.size + tags.size - shared));
    }
    if (best === 0) continue;
    const score = best + (languages.has(novel.language.toLowerCase()) ? 0.05 : 0) + Math.min(novel.chapters, 2000) / 200000;
    scored.push({ novel, score });
  }
  scored.sort((a, b) => b.score - a.score);
  // One edition per work in the suggestions.
  const seen = new Set<string>();
  const out: Novel[] = [];
  for (const { novel } of scored) {
    const key = workKey(novel.title);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(novel);
    if (out.length >= limit) break;
  }
  return out;
}

export type NovelSort = "title" | "updated" | "new" | "chapters" | "popular" | "rating";

const time = (iso?: string) => (iso ? Date.parse(iso) || 0 : 0);

/** Sorted copy. Novels without the data (no date, no rating) go last, in title order. */
export function sortNovels(novels: readonly Novel[], sort: NovelSort, direction: "asc" | "desc" = "asc"): Novel[] {
  const byTitle = (a: Novel, b: Novel) => a.title.localeCompare(b.title, "pt-BR", { numeric: true, sensitivity: "base" });
  const value: Record<Exclude<NovelSort, "title">, (n: Novel) => number> = {
    updated: (n) => time(n.lastChapterAt),
    new: (n) => time(n.firstSeenAt),
    chapters: (n) => n.chapters,
    popular: (n) => n.views ?? 0,
    rating: (n) => (n.rating ?? 0) * 1e6 + (n.ratingVotes ?? 0)
  };
  const list = [...novels];
  if (sort === "title") {
    list.sort(byTitle);
    return direction === "asc" ? list : list.reverse();
  }
  const get = value[sort];
  return list.sort((a, b) => get(b) - get(a) || byTitle(a, b));
}

/** Story tags (genres and themes) of a novel in the index; empty if unknown. */
export function storyTagsOf(index: CatalogIndex, novelId: string): Set<string> {
  const entry = index.entries.find((item) => item.novel.id === novelId);
  return entry ? storyTags(entry.tagKeys) : new Set();
}

/** Best Jaccard similarity of every indexed novel to the seeds, and the story tags it shares. */
export function similarityToSeeds(index: CatalogIndex, seeds: Novel[]): Map<string, { score: number; shared: string[] }> {
  const seedTags = seeds.map((seed) => storyTagsOf(index, seed.id)).filter((tags) => tags.size > 0);
  const out = new Map<string, { score: number; shared: string[] }>();
  if (!seedTags.length) return out;
  for (const entry of index.entries) {
    const tags = storyTags(entry.tagKeys);
    let best = 0;
    let bestShared: string[] = [];
    for (const seed of seedTags) {
      const shared = [...tags].filter((tag) => seed.has(tag));
      const score = shared.length / (seed.size + tags.size - shared.length || 1);
      if (score > best) {
        best = score;
        bestShared = shared;
      }
    }
    if (best > 0) out.set(entry.novel.id, { score: best, shared: bestShared });
  }
  return out;
}

/**
 * Story keywords (already normalized) found in each novel's title, tags or synopsis, by word
 * start. Feeds the candidate pre-selection of the smart filter: "sombra", "pesadelo",
 * "nightmare" find the synopses that talk about it even when the tags do not.
 */
export function keywordHits(index: CatalogIndex, keywords: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (!keywords.length) return out;
  for (const entry of index.entries) {
    const found = keywords.filter((word) =>
      hasWord(entry.description, word) || hasWord(entry.title, word) || hasWord(entry.tags, word));
    if (found.length) out.set(entry.novel.id, found);
  }
  return out;
}
