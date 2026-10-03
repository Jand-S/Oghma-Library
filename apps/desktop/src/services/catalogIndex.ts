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
