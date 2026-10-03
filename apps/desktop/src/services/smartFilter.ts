// "Filtro inteligente" (Buscar): a request in plain words becomes Discover filters plus a
// ranking with reasons. With the user's ChatGPT login (the translation account) one short
// call (Luna, ~3k tokens) reads the request; without it a local interpreter understands the
// basics. Either way the catalog search and the ranking run locally (services/catalogIndex).
import { defaultFilters } from "../core/defaults";
import { canonicalTagText, normalizeSearchText } from "../core/tagFilters";
import type { Filters, Novel, TagCatalogItem } from "../core/types";
import { isTauriRuntime } from "../core/windowControls";
import { searchCatalog, similarityToSeeds, workKey, type CatalogIndex } from "./catalogIndex";

export type SmartIntent = {
  /** One sentence: what was understood (shown to the user). */
  summary: string;
  includeTags: string[];
  excludeTags: string[];
  status: Filters["status"];
  language: string;
  minChapters: number | null;
  maxChapters: number | null;
  /** Titles the user gave as a reference ("algo como Shadow Slave"). */
  like: string[];
  /** Words to search in title/synopsis that are not tags (rare). */
  query: string;
};

export type SmartResult = {
  intent: SmartIntent;
  /** Discover filters to apply (the normal filter bar shows and edits them). */
  filters: Filters;
  /** Reference novels found in the catalog. */
  seeds: Novel[];
  /** Ranking for every catalog novel (higher first) and a short reason. */
  scores: Record<string, number>;
  reasons: Record<string, string>;
  /** "ai": read by ChatGPT; "local": local interpreter (no login, or the call failed). */
  source: "ai" | "local";
  /** Why the local interpreter was used, when the AI was expected. */
  fallbackReason?: string;
  credits?: number;
};

export type AskModel = (instructions: string, text: string) => Promise<{ text: string; credits?: number }>;

/** True when the translation login (ChatGPT) is active. False outside the app. */
export async function chatGptLoggedIn(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const account = await invoke<{ loggedIn?: boolean } | null>("translation_account");
    return Boolean(account?.loggedIn);
  } catch {
    return false;
  }
}

/** The user's ChatGPT plan through the translation login (Tauri only). Null outside the app. */
export function chatGptAsker(): AskModel | null {
  if (!isTauriRuntime()) return null;
  return async (instructions, text) => {
    const { invoke } = await import("@tauri-apps/api/core");
    const answer = await invoke<{ text: string; credits: number }>("smart_filter_ask", { instructions, text });
    return { text: answer.text, credits: answer.credits };
  };
}

const STATUSES = new Set(["any", "ongoing", "complete", "paused"]);

export function buildInstructions(tags: TagCatalogItem[]): string {
  const list = tags
    .filter((tag) => !tag.key.startsWith("raw.") && tag.count > 0)
    .map((tag) => `${tag.key}=${tag.label}`)
    .join("; ");
  return [
    "Você transforma um pedido de leitura (light novels, web novels) em filtros de busca.",
    "Responda SOMENTE com um objeto JSON, sem texto antes ou depois, neste formato:",
    '{"summary": "frase curta em português do que você entendeu", "includeTags": ["key"], "excludeTags": ["key"],',
    '"status": "any|ongoing|complete|paused", "language": "all|pt-br|en", "minChapters": null, "maxChapters": null,',
    '"like": ["títulos citados como referência"], "query": ""}',
    "Regras: use apenas keys da lista de tags abaixo; inclua só as tags que o pedido pede de fato (no máximo 4);",
    "\"parecido com X\" vai em like, não vira tags; números de capítulos viram minChapters/maxChapters;",
    "\"completa/finalizada\" é status complete; query só para palavras que não são tags nem títulos (quase sempre vazio).",
    `Tags: ${list}`
  ].join("\n");
}

/** Reads the model answer: the first JSON object, every field checked. */
export function parseIntent(answer: string, validKeys: ReadonlySet<string>): SmartIntent | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(answer.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null);
  const status = typeof raw.status === "string" && STATUSES.has(raw.status) ? (raw.status as Filters["status"]) : "any";
  const language = raw.language === "pt-br" || raw.language === "en" ? raw.language : "all";
  return {
    summary: typeof raw.summary === "string" ? raw.summary.slice(0, 240) : "",
    includeTags: strings(raw.includeTags).filter((key) => validKeys.has(key)).slice(0, 6),
    excludeTags: strings(raw.excludeTags).filter((key) => validKeys.has(key)).slice(0, 6),
    status,
    language,
    minChapters: num(raw.minChapters),
    maxChapters: num(raw.maxChapters),
    like: strings(raw.like).map((title) => title.trim()).filter(Boolean).slice(0, 4),
    query: typeof raw.query === "string" ? raw.query.slice(0, 80) : ""
  };
}

/** Words → tag key, longest phrase first ("sistema de nivel" before "sistema"). */
function tagPhrases(tags: TagCatalogItem[]): Array<{ phrase: string; key: string }> {
  const phrases: Array<{ phrase: string; key: string }> = [];
  for (const tag of tags) {
    for (const text of new Set([tag.label, ...tag.aliases, ...canonicalTagText(tag.key)])) {
      const phrase = normalizeSearchText(text);
      if (phrase.length >= 3) phrases.push({ phrase, key: tag.key });
    }
  }
  return phrases.sort((a, b) => b.phrase.length - a.phrase.length);
}

/** Local interpreter (no AI): status, language, chapter limits, "parecido com X", tags and "sem X". */
export function localIntent(request: string, tags: TagCatalogItem[]): SmartIntent {
  let text = ` ${normalizeSearchText(request)} `;
  const intent: SmartIntent = {
    summary: "", includeTags: [], excludeTags: [], status: "any", language: "all",
    minChapters: null, maxChapters: null, like: [], query: ""
  };
  // "parecido com Shadow Slave", "tipo Solo Leveling", "estilo X" (from the original text, case kept).
  const like = request.match(/(?:parecid[oa]s?\s+com|tipo|estilo|igual\s+a|no\s+estilo\s+de|similar\s+a)\s+["“]?([^,."”;]+?)["”]?(?=\s*(?:,|\.|;|\bmas\b|\bcom\b|\bsem\b|\bque\b|$))/i);
  if (like) {
    intent.like.push(like[1].trim());
    text = text.replace(` ${normalizeSearchText(like[0])} `, " ");
  }
  if (/\b(completa|completo|completas|finalizad[ao]s?|terminad[ao]s?|concluid[ao]s?)\b/.test(text)) intent.status = "complete";
  else if (/\b(em andamento|lancamento|ativa|em lancamento)\b/.test(text)) intent.status = "ongoing";
  if (/\b(portugues|pt br|traduzid[ao]s?)\b/.test(text)) intent.language = "pt-br";
  else if (/\b(ingles|english)\b/.test(text)) intent.language = "en";
  const max = text.match(/\b(?:menos de|ate|no maximo|maximo de|max)\s+(\d+)\s*(?:cap|capitulos)?/);
  if (max) intent.maxChapters = Number(max[1]);
  const min = text.match(/\b(?:mais de|pelo menos|acima de|minimo de|no minimo)\s+(\d+)\s*(?:cap|capitulos)?/);
  if (min) intent.minChapters = Number(min[1]);
  // "sem harem", "nada de romance", "nao quero ecchi": exclusions first, then inclusions.
  for (const { phrase, key } of tagPhrases(tags)) {
    const negated = new RegExp(`\\b(?:sem|nada de|nao quero|evitar|tirando)\\s+(?:[a-z]+\\s+)?${phrase}\\b`);
    if (negated.test(text)) {
      if (!intent.excludeTags.includes(key)) intent.excludeTags.push(key);
      text = text.replace(negated, " ");
    }
  }
  for (const { phrase, key } of tagPhrases(tags)) {
    if (text.includes(` ${phrase} `) && !intent.includeTags.includes(key) && !intent.excludeTags.includes(key)) {
      intent.includeTags.push(key);
      text = text.replace(` ${phrase} `, " ");
    }
  }
  intent.includeTags = intent.includeTags.slice(0, 4);
  return intent;
}

/** Best catalog match for a title the user typed (exact work first, then the search ranking). */
export function findTitle(index: CatalogIndex, title: string): Novel | null {
  const key = workKey(title);
  const exact = index.entries.find((entry) => workKey(entry.novel.title) === key);
  if (exact) return exact.novel;
  const hits = searchCatalog(index, { ...defaultFilters("all"), query: title });
  return hits[0] ?? null;
}

function describe(intent: SmartIntent, seeds: Novel[], tags: TagCatalogItem[]): string {
  if (intent.summary) return intent.summary;
  const label = (key: string) => tags.find((tag) => tag.key === key)?.label ?? key;
  const parts: string[] = [];
  if (seeds.length) parts.push(`parecido com ${seeds.map((seed) => seed.title).join(", ")}`);
  if (intent.includeTags.length) parts.push(intent.includeTags.map(label).join(", "));
  if (intent.status === "complete") parts.push("completa");
  if (intent.status === "ongoing") parts.push("em andamento");
  if (intent.maxChapters) parts.push(`até ${intent.maxChapters} capítulos`);
  if (intent.minChapters) parts.push(`pelo menos ${intent.minChapters} capítulos`);
  if (intent.excludeTags.length) parts.push(`sem ${intent.excludeTags.map(label).join(", ")}`);
  if (intent.language === "pt-br") parts.push("em português");
  if (intent.language === "en") parts.push("em inglês");
  return parts.length ? parts.join(" · ") : "Nada específico: mostrando as obras mais completas e bem avaliadas.";
}

/** Turns an intent into Discover filters, seeds, ranking and reasons (all local). */
export function applyIntent(index: CatalogIndex, intent: SmartIntent, tags: TagCatalogItem[]): Omit<SmartResult, "source"> {
  const seeds = intent.like.map((title) => findTitle(index, title)).filter((novel): novel is Novel => Boolean(novel));
  const filters: Filters = {
    ...defaultFilters("all"),
    query: intent.query,
    includeTags: intent.includeTags,
    excludeTags: intent.excludeTags,
    status: intent.status,
    language: intent.language,
    minChapters: intent.minChapters ?? defaultFilters().minChapters,
    maxChapters: intent.maxChapters ?? defaultFilters().maxChapters
  };
  const label = (key: string) => tags.find((tag) => tag.key === key)?.label ?? canonicalTagText(key)[0] ?? key.replace(/^\w+\./, "");
  const similarity = similarityToSeeds(index, seeds);
  const seedWorks = new Set(seeds.map((seed) => workKey(seed.title)));
  const scores: Record<string, number> = {};
  const reasons: Record<string, string> = {};
  for (const { novel } of index.entries) {
    const sim = similarity.get(novel.id);
    const quality = (novel.rating ?? 0) / 50 + Math.min(novel.chapters, 2000) / 100000;
    scores[novel.id] = seedWorks.has(workKey(novel.title)) ? -1 : (sim?.score ?? 0) + quality;
    if (sim && sim.shared.length) {
      reasons[novel.id] = `Em comum com ${seeds[0]?.title ?? "a referência"}: ${sim.shared.slice(0, 4).map(label).join(", ")}`;
    } else if (intent.includeTags.length) {
      reasons[novel.id] = intent.includeTags.map(label).join(" · ");
    }
  }
  return { intent: { ...intent, summary: describe(intent, seeds, tags) }, filters, seeds, scores, reasons };
}

/** Full flow: ask the model when available (falls back to the local interpreter on any error). */
export async function runSmartFilter(
  request: string,
  deps: { index: CatalogIndex; tags: TagCatalogItem[]; ask?: AskModel | null }
): Promise<SmartResult> {
  const validKeys = new Set(deps.tags.map((tag) => tag.key));
  if (deps.ask) {
    try {
      const answer = await deps.ask(buildInstructions(deps.tags), request);
      const intent = parseIntent(answer.text, validKeys);
      if (intent) return { ...applyIntent(deps.index, intent, deps.tags), source: "ai", credits: answer.credits };
      return { ...applyIntent(deps.index, localIntent(request, deps.tags), deps.tags), source: "local", fallbackReason: "invalid_answer" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { ...applyIntent(deps.index, localIntent(request, deps.tags), deps.tags), source: "local", fallbackReason: reason };
    }
  }
  return { ...applyIntent(deps.index, localIntent(request, deps.tags), deps.tags), source: "local" };
}
