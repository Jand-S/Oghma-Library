// "Filtro inteligente" (Buscar): a request in plain words becomes Discover filters plus a
// ranking with reasons.
//
// With the user's ChatGPT login (the translation account), on Luna:
// 1. One short call reads the request: filters, the reference titles and a profile of the
//    story wanted (protagonist, premise, world, tone) with story keywords in PT and EN.
// 2. When the request is about the story ("parecido com Shadow Slave", "protagonista frio que
//    renasce"), the app pre-selects ~36 candidates locally (story tags shared with the
//    reference + keywords in the synopses) and a second call reads their synopses and keeps
//    only the ones that really share story elements, each with a concrete reason. The grid
//    then shows only those picks; tags alone no longer make a recommendation.
// Without the login a local interpreter understands the basics and ranks by shared tags.
import { defaultFilters } from "../core/defaults";
import { canonicalTagText, normalizeSearchText } from "../core/tagFilters";
import type { Filters, Novel, TagCatalogItem } from "../core/types";
import { isTauriRuntime } from "../core/windowControls";
import { keywordHits, searchCatalog, similarityToSeeds, workKey, type CatalogIndex } from "./catalogIndex";

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
  /** What defines the story wanted (protagonist, premise, world, tone); empty for plain filters. */
  profile: string;
  /** Short words, PT and EN, that synopses of such stories would use ("sombra", "nightmare"). */
  keywords: string[];
  /** Works the model knows that share story elements with the request (looked up by title). */
  alsoLike: string[];
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
  /** Novels the model kept after reading the synopses, best first. Absent: no curation ran. */
  picks?: string[];
  /** How many candidates the model read (with `picks`). */
  candidatesRead?: number;
  /** The curation call failed or answered garbage: the ranking is by shared tags only. */
  curationFailed?: boolean;
  /** "ai": read by ChatGPT; "local": local interpreter (no login, or the call failed). */
  source: "ai" | "local";
  /** Why the local interpreter was used, when the AI was expected. */
  fallbackReason?: string;
  credits?: number;
};

export type AskModel = (instructions: string, text: string, effort?: "none" | "low") => Promise<{ text: string; credits?: number }>;

export type SmartStage = "understanding" | "reading";

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
  return async (instructions, text, effort = "none") => {
    const { invoke } = await import("@tauri-apps/api/core");
    const answer = await invoke<{ text: string; credits: number }>("smart_filter_ask", { instructions, text, effort });
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
    '"like": ["títulos citados como referência"], "query": "", "profile": "", "keywords": [], "alsoLike": []}',
    "Regras: use apenas keys da lista de tags abaixo; inclua só as tags que o pedido pede de fato (no máximo 4);",
    "\"parecido com X\" vai em like, não vira tags; números de capítulos viram minChapters/maxChapters;",
    "\"completa/finalizada\" é status complete; query só para palavras que não são tags nem títulos (quase sempre vazio).",
    "profile: quando o pedido cita obras de referência ou fala da história, descreva em 2 a 4 frases objetivas o que define",
    "a história pedida: protagonista (personalidade, origem, poder, arco), premissa, mundo, tom e o que a torna marcante.",
    "Use o que você sabe das obras citadas. Deixe vazio se o pedido for só de filtros objetivos (gênero, status, tamanho).",
    "keywords: com profile, 8 a 16 palavras curtas, em português e em inglês, que a sinopse de uma obra assim usaria",
    "(ex.: sombra, shadow, pesadelo, nightmare, maldição, curse). Sem nomes de personagens.",
    "alsoLike: com profile, até 15 títulos de light/web novels que você conhece e que têm pontos de HISTÓRIA em comum",
    "(protagonista, premissa, mundo, tom), com o nome em inglês mais conhecido. Não precisa saber se estão no catálogo.",
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
    query: typeof raw.query === "string" ? raw.query.slice(0, 80) : "",
    profile: typeof raw.profile === "string" ? raw.profile.trim().slice(0, 900) : "",
    keywords: strings(raw.keywords).map((word) => word.trim()).filter(Boolean).slice(0, 20),
    alsoLike: strings(raw.alsoLike).map((title) => title.trim()).filter(Boolean).slice(0, 15)
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
    minChapters: null, maxChapters: null, like: [], query: "", profile: "", keywords: [], alsoLike: []
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

/* ---------- Curation: the model reads the synopses ---------- */

/** Candidates the model reads; 48 synopses of ~450 characters stay around 9k input tokens. */
export const CURATION_CANDIDATES = 48;
const MAX_PICKS = 12;
const MIN_PICK_SCORE = 7;

/** The request is about the story (a reference or a profile), not only objective filters. */
export function wantsCuration(intent: SmartIntent): boolean {
  return intent.like.length > 0 || intent.profile.length > 0;
}

/**
 * Local pre-selection for the curation: the novels allowed by the filters, one edition per
 * work, the references left out. The works the model itself named (`alsoLike`, matched by exact
 * title) come first; then story tags shared with the references plus story keywords found in
 * the synopses (rare words weigh more), and a little the rating.
 */
export function selectCandidates(index: CatalogIndex, intent: SmartIntent, seeds: Novel[], filters: Filters, limit = CURATION_CANDIDATES): Novel[] {
  const pool = searchCatalog(index, { ...filters, query: "" });
  const similarity = similarityToSeeds(index, seeds);
  const words = [...new Set([...intent.keywords, ...intent.query.split(/\s+/)].map(normalizeSearchText).filter((word) => word.length >= 3))];
  const hits = keywordHits(index, words.slice(0, 24));
  // Rare words weigh more (IDF): "pesadelo" says more about a story than "monstro" or "sistema".
  const df = new Map<string, number>();
  for (const found of hits.values()) for (const word of found) df.set(word, (df.get(word) ?? 0) + 1);
  const idf = (word: string) => Math.log(index.entries.length / (1 + (df.get(word) ?? 0)));
  const keywordScore = (id: string) => Math.min((hits.get(id) ?? []).reduce((sum, word) => sum + Math.max(idf(word), 0), 0) / 4, 4);
  const seedWorks = new Set(seeds.map((seed) => workKey(seed.title)));
  const named = new Set(intent.alsoLike.map(workKey));
  const scored = pool
    .filter((novel) => !seedWorks.has(workKey(novel.title)))
    .map((novel) => ({
      novel,
      score: (named.has(workKey(novel.title)) ? 10 : 0)
        + (similarity.get(novel.id)?.score ?? 0) * 2.5 + keywordScore(novel.id) + (novel.rating ?? 0) / 25
    }))
    .sort((a, b) => b.score - a.score);
  // One edition per work, ranked by its best edition; the model reads the Portuguese one when
  // there is one (the grid's "Também em" shows the others).
  const works = new Map<string, Novel[]>();
  for (const { novel } of scored) {
    const key = workKey(novel.title);
    const editions = works.get(key);
    if (editions) editions.push(novel);
    else works.set(key, [novel]);
  }
  return [...works.values()]
    .slice(0, limit)
    .map((editions) => editions.find((novel) => novel.language.toLowerCase() === "pt-br") ?? editions[0]);
}

export const CURATION_INSTRUCTIONS = [
  "Você é um curador exigente de light novels e web novels.",
  "Recebe o pedido do leitor, o perfil da história que ele quer, as obras de referência e uma lista de candidatos",
  "(id, título, tags, sinopse). Avalie cada candidato pela HISTÓRIA: protagonista (personalidade, origem, poder, arco),",
  "premissa, mundo, tom e estrutura. Tags iguais NÃO bastam: duas fantasias de ação com sistema podem não ter nada em comum.",
  "Dê uma nota de 0 a 10 para o quanto quem gostou da referência (ou quem fez o pedido) teria a mesma experiência.",
  'Responda SOMENTE com JSON: {"picks":[{"id":"c3","score":8,"reason":"..."}]}',
  `Regras: só notas ${MIN_PICK_SCORE} ou mais, no máximo ${MAX_PICKS}, da maior para a menor. Se nenhum chegar a ${MIN_PICK_SCORE}, responda {"picks":[]}.`,
  "reason: uma frase curta (até 140 caracteres) em português com os pontos concretos em comum (ex.: \"protagonista órfão que sobrevive com um poder",
  "amaldiçoado num mundo de pesadelos\"). Use só o que a sinopse diz; não invente. Nunca escolha a própria referência ou outra edição dela."
].join("\n");

const SYNOPSIS_CHARS = 450;

function plainSynopsis(text: string, max = SYNOPSIS_CHARS): string {
  const plain = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > max ? `${plain.slice(0, max).replace(/\s+\S*$/, "")}…` : plain;
}

const statusLabel: Record<string, string> = { complete: "completa", ongoing: "em andamento", paused: "pausada" };

/** The text of the curation call. Candidates get short ids (c1, c2…) to keep it small. */
export function buildCurationText(request: string, intent: SmartIntent, seeds: Novel[], candidates: Novel[]): string {
  const lines = [`Pedido: ${request}`];
  if (intent.profile) lines.push(`Perfil da história: ${intent.profile}`);
  for (const seed of seeds) {
    lines.push(`Referência: ${seed.title} | tags: ${seed.tags.slice(0, 8).join(", ")}`, `Sinopse: ${plainSynopsis(seed.description, 800)}`);
  }
  lines.push("", "Candidatos:");
  candidates.forEach((novel, i) => {
    const facts = [`${novel.chapters} cap.`, statusLabel[novel.status]].filter(Boolean).join(", ");
    lines.push(`[c${i + 1}] ${novel.title} | tags: ${novel.tags.slice(0, 8).join(", ")} | ${facts}`, plainSynopsis(novel.description) || "(sem sinopse)");
  });
  return lines.join("\n");
}

/** Reads the curation answer: known ids only, score checked, best first, no repeats. */
export function parsePicks(answer: string, candidates: Novel[]): { ids: string[]; reasons: Record<string, string>; scores: Record<string, number> } | null {
  const start = answer.indexOf("{");
  const end = answer.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(answer.slice(start, end + 1));
  } catch {
    return null;
  }
  const list = (raw as { picks?: unknown }).picks;
  if (!Array.isArray(list)) return null;
  const picks = list
    .map((item) => item as { id?: unknown; score?: unknown; reason?: unknown })
    .map((item) => ({
      novel: typeof item.id === "string" ? candidates[Number(item.id.replace(/^c/i, "")) - 1] : undefined,
      score: typeof item.score === "number" ? item.score : 0,
      reason: typeof item.reason === "string" ? item.reason.trim().slice(0, 240) : ""
    }))
    .filter((pick): pick is { novel: Novel; score: number; reason: string } => Boolean(pick.novel) && pick.score >= MIN_PICK_SCORE)
    .sort((a, b) => b.score - a.score);
  const ids: string[] = [];
  const reasons: Record<string, string> = {};
  const scores: Record<string, number> = {};
  for (const pick of picks) {
    if (ids.includes(pick.novel.id) || ids.length >= MAX_PICKS) continue;
    scores[pick.novel.id] = 100 + pick.score - ids.length / 100;
    ids.push(pick.novel.id);
    if (pick.reason) reasons[pick.novel.id] = pick.reason;
  }
  return { ids, reasons, scores };
}

/** Full flow: ask the model when available (falls back to the local interpreter on any error). */
export async function runSmartFilter(
  request: string,
  deps: { index: CatalogIndex; tags: TagCatalogItem[]; ask?: AskModel | null; onStage?: (stage: SmartStage, candidates?: number) => void }
): Promise<SmartResult> {
  const validKeys = new Set(deps.tags.map((tag) => tag.key));
  const local = (fallbackReason?: string): SmartResult => ({
    ...applyIntent(deps.index, localIntent(request, deps.tags), deps.tags),
    source: "local",
    ...(fallbackReason ? { fallbackReason } : {})
  });
  if (!deps.ask) return local();
  let intent: SmartIntent | null;
  let credits = 0;
  try {
    deps.onStage?.("understanding");
    const answer = await deps.ask(buildInstructions(deps.tags), request);
    credits += answer.credits ?? 0;
    intent = parseIntent(answer.text, validKeys);
  } catch (error) {
    return local(error instanceof Error ? error.message : String(error));
  }
  if (!intent) return local("invalid_answer");
  const base: SmartResult = { ...applyIntent(deps.index, intent, deps.tags), source: "ai", credits };
  if (!wantsCuration(intent)) return base;

  const candidates = selectCandidates(deps.index, intent, base.seeds, base.filters);
  if (!candidates.length) return { ...base, picks: [], candidatesRead: 0 };
  try {
    deps.onStage?.("reading", candidates.length);
    const answer = await deps.ask(CURATION_INSTRUCTIONS, buildCurationText(request, intent, base.seeds, candidates), "low");
    credits += answer.credits ?? 0;
    const picks = parsePicks(answer.text, candidates);
    if (!picks) return { ...base, credits, curationFailed: true };
    return {
      ...base,
      credits,
      picks: picks.ids,
      candidatesRead: candidates.length,
      scores: { ...base.scores, ...picks.scores },
      // The model's reasons replace the "tags in common" ones; the rest of the grid is hidden anyway.
      reasons: { ...base.reasons, ...picks.reasons }
    };
  } catch {
    return { ...base, credits, curationFailed: true };
  }
}
