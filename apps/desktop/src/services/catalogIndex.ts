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

/** Published by the server (`oghma discovery-build`): similar novels by story (embeddings of
 *  the story card or synopsis + shared tags) and editions of the same work the title misses
 *  (a translation with another name). */
export type Discovery = {
  similar: Map<string, Array<[string, number]>>;
  editions: Map<string, string[]>;
};

export type CatalogIndex = {
  entries: Entry[];
  byId: Map<string, Novel>;
  discovery?: Discovery;
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
  // A book downloaded under an old id (the site moved the novel) still finds it.
  for (const { novel } of entries) for (const alias of novel.aliases ?? []) if (!byId.has(alias)) byId.set(alias, novel);
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
  const byTitle = key
    ? index.entries
      .filter((entry) => entry.novel.id !== novel.id && entry.novel.sourceId !== novel.sourceId && workKey(entry.novel.title) === key)
      .map((entry) => entry.novel)
    : [];
  // Plus the translations under another name that the server recognized by the synopsis.
  const byStory = (index.discovery?.editions.get(novel.id) ?? [])
    .map((id) => index.byId.get(id))
    .filter((other): other is Novel => Boolean(other) && other!.sourceId !== novel.sourceId);
  const unique = new Map([...byTitle, ...byStory].map((other) => [other.id, other]));
  return [...unique.values()].sort((a, b) => b.chapters - a.chapters);
}

/** Editions of one work in a list of results (one card in Buscar); `main` is the most complete. */
export type NovelStack = { key: string; main: Novel; items: Novel[] };

/**
 * Groups results by work, stricter than `editionsOf` (thousands of novels, generic titles):
 * same title AND same author, or the server matched the synopses (translations under another
 * name). Stacks keep the order of their first novel; the face is the edition with most chapters.
 */
export function stackNovels(novels: Novel[], index: CatalogIndex | null): NovelStack[] {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  for (const novel of novels) parent.set(novel.id, novel.id);
  const byId = new Map(novels.map((novel) => [novel.id, novel]));
  const byTitleAuthor = new Map<string, string>();
  for (const novel of novels) {
    const title = workKey(novel.title);
    const author = workKey(novel.author ?? "");
    if (title && author) {
      const key = `${title}|${author}`;
      const first = byTitleAuthor.get(key);
      if (first && byId.get(first)?.sourceId !== novel.sourceId) union(first, novel.id);
      else if (!first) byTitleAuthor.set(key, novel.id);
    }
    for (const other of index?.discovery?.editions.get(novel.id) ?? []) {
      if (parent.has(other)) union(novel.id, other);
    }
  }
  const stacks = new Map<string, NovelStack>();
  for (const novel of novels) {
    const root = find(novel.id);
    const stack = stacks.get(root);
    if (stack) {
      stack.items.push(novel);
      if (novel.chapters > stack.main.chapters) stack.main = novel;
    } else {
      stacks.set(root, { key: root, main: novel, items: [novel] });
    }
  }
  return [...stacks.values()];
}

export type SimilarOptions = {
  limit?: number;
  exclude?: ReadonlySet<string>;
  sourceIds?: readonly string[];
  /** Weight of each seed (same order as `seeds`; default 1): a 5-star book pulls harder than a 3-star one. */
  weights?: readonly number[];
  /** Books the reader disliked (low rating, dropped): novels close to them sink. */
  avoid?: readonly Novel[];
};

/** How much a disliked book pushes its look-alikes down, relative to a seed of weight 1. */
const AVOID_WEIGHT = 0.6;

/**
 * Similar novels from the server's list, when every seed has one: the (weighted) scores of all
 * seeds are summed, so "Para você" with several favorites favors what is close to many of them,
 * and what is close to a disliked book loses points. Null (caller falls back to tags) without the list.
 */
function similarFromDiscovery(
  index: CatalogIndex,
  seeds: Novel[],
  limit: number,
  options: SimilarOptions
): Novel[] | null {
  const lists = seeds.map((seed) => index.discovery?.similar.get(seed.id));
  if (!lists.length || lists.some((list) => !list)) return null;
  const seedWorks = new Set(seeds.flatMap((seed) => [seed, ...editionsOf(index, seed)]).map((novel) => workKey(novel.title)));
  const allowed = options.sourceIds ? new Set(options.sourceIds) : null;
  const total = new Map<string, number>();
  lists.forEach((list, i) => {
    const weight = options.weights?.[i] ?? 1;
    for (const [id, score] of list!) total.set(id, (total.get(id) ?? 0) + score * weight);
  });
  for (const disliked of options.avoid ?? []) {
    for (const [id, score] of index.discovery?.similar.get(disliked.id) ?? []) {
      if (total.has(id)) total.set(id, total.get(id)! - score * AVOID_WEIGHT);
    }
  }
  const avoidWorks = new Set((options.avoid ?? []).map((novel) => workKey(novel.title)));
  for (const [id, score] of total) {
    const novel = index.byId.get(id);
    if (score <= 0 || (novel && avoidWorks.has(workKey(novel.title)))) total.delete(id);
  }
  const out: Novel[] = [];
  const seen = new Set<string>();
  for (const [id] of [...total.entries()].sort((a, b) => b[1] - a[1])) {
    const novel = index.byId.get(id);
    if (!novel || options.exclude?.has(id)) continue;
    // The list was built over every source: an edition in an enabled source stands in for a
    // disabled one.
    const shown = allowed && !allowed.has(novel.sourceId)
      ? editionsOf(index, novel).find((edition) => allowed.has(edition.sourceId))
      : novel;
    if (!shown) continue;
    const key = workKey(shown.title);
    if (seedWorks.has(key) || seen.has(key) || seen.has(workKey(novel.title))) continue;
    // A translation under another name is the same work: "True Martial World" hides
    // "Mundo Marcial Verdadeiro" further down the list.
    for (const same of [novel, shown, ...editionsOf(index, novel)]) seen.add(workKey(same.title));
    out.push(shown);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Novels that share the most story tags with `seeds` (Jaccard similarity), skipping the
 * seeds, their other editions and anything in `exclude`. Same language as the seeds counts a
 * little extra, so a Portuguese reader gets Portuguese suggestions first.
 */
export function similarNovels(
  index: CatalogIndex,
  seeds: Novel[],
  options: SimilarOptions = {}
): Novel[] {
  const limit = options.limit ?? 8;
  if (!seeds.length) return [];
  const precomputed = similarFromDiscovery(index, seeds, limit, options);
  if (precomputed) return precomputed;
  const tagsOfSeed = (seed: Novel) => {
    const entry = index.entries.find((item) => item.novel.id === seed.id);
    return entry ? storyTags(entry.tagKeys) : null;
  };
  const seedTags = seeds
    .map((seed, i) => ({ tags: tagsOfSeed(seed), weight: options.weights?.[i] ?? 1 }))
    .filter((seed): seed is { tags: Set<string>; weight: number } => Boolean(seed.tags));
  const avoidTags = (options.avoid ?? []).map(tagsOfSeed).filter((tags): tags is Set<string> => Boolean(tags));
  const seedWorks = new Set([...seeds, ...(options.avoid ?? [])].map((seed) => workKey(seed.title)));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    let shared = 0;
    for (const tag of a) if (b.has(tag)) shared += 1;
    return shared < 2 ? 0 : shared / (a.size + b.size - shared);
  };
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
    for (const seed of seedTags) best = Math.max(best, jaccard(seed.tags, tags) * seed.weight);
    if (best <= 0) continue;
    let penalty = 0;
    for (const disliked of avoidTags) penalty = Math.max(penalty, jaccard(disliked, tags));
    const affinity = best - penalty * AVOID_WEIGHT;
    if (affinity <= 0) continue;
    const score = affinity + (languages.has(novel.language.toLowerCase()) ? 0.05 : 0) + Math.min(novel.chapters, 2000) / 200000;
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
