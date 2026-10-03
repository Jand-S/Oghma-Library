import { describe, expect, it, vi } from "vitest";
import type { Novel, TagCatalogItem } from "../core/types";
import { buildCatalogIndex } from "../services/catalogIndex";
import {
  CURATION_INSTRUCTIONS,
  applyIntent,
  buildInstructions,
  localIntent,
  parseIntent,
  parsePicks,
  runSmartFilter,
  selectCandidates
} from "../services/smartFilter";

const tag = (key: string, label: string, aliases: string[] = []): TagCatalogItem =>
  ({ key, label, category: key.startsWith("genre") ? "genre" : "theme", aliases, count: 5 });
const tags = [
  tag("genre.action", "Ação", ["acao", "action"]),
  tag("genre.fantasy", "Fantasia", ["fantasy"]),
  tag("theme.harem", "Harém", ["harem"]),
  tag("theme.level_system", "Sistema de Nível", ["level system"]),
  tag("genre.romance", "Romance"),
  tag("theme.female_protagonist", "Protagonista Feminina", ["female lead"])
];

function novel(id: string, patch: Partial<Novel>): Novel {
  return {
    id, title: id, author: "", sourceId: "central-novel", sourceName: "Central Novel", tags: [], tagKeys: [],
    status: "ongoing", chapters: 300, language: "pt-BR", updatedAt: "", description: "", coverClass: "", ...patch
  };
}
const index = buildCatalogIndex([
  novel("Shadow Slave", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], chapters: 2000 }),
  novel("Solo Leveling", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], status: "complete", chapters: 270 }),
  novel("Harém do Herói", { tagKeys: ["genre.action", "genre.fantasy", "theme.harem"], status: "complete" }),
  novel("Amor de Verão", { tagKeys: ["genre.romance"], status: "complete" })
]);

describe("smart filter: local interpreter (no login)", () => {
  it("understands reference title, status, chapter limit, tags and exclusions", () => {
    const intent = localIntent("Quero algo parecido com Shadow Slave, completa, até 800 capítulos, sem harém", tags);
    expect(intent.like).toEqual(["Shadow Slave"]);
    expect(intent.status).toBe("complete");
    expect(intent.maxChapters).toBe(800);
    expect(intent.excludeTags).toEqual(["theme.harem"]);
    expect(localIntent("fantasia com sistema de nível em português", tags)).toMatchObject({
      includeTags: ["theme.level_system", "genre.fantasy"], language: "pt-br"
    });
  });

  it("ranks by similarity to the reference and explains why; the reference itself is out", () => {
    const result = applyIntent(index, localIntent("parecido com Shadow Slave, completa", tags), tags);
    expect(result.seeds.map((n) => n.id)).toEqual(["Shadow Slave"]);
    expect(result.filters.status).toBe("complete");
    const order = Object.entries(result.scores).sort((a, b) => b[1] - a[1]).map(([id]) => id);
    expect(order[0]).toBe("Solo Leveling");
    expect(result.scores["Shadow Slave"]).toBe(-1);
    expect(result.reasons["Solo Leveling"]).toBe("Em comum com Shadow Slave: Ação, Fantasia, Sistema de Nível");
    expect(result.intent.summary).toContain("parecido com Shadow Slave");
  });
});

describe("smart filter: ChatGPT answer", () => {
  const valid = new Set(tags.map((t) => t.key));

  it("reads the JSON even with text around it and drops unknown keys and bad values", () => {
    const intent = parseIntent('Claro! {"summary":"Ação completa","includeTags":["genre.action","genre.inventada"],"status":"complete","language":"xx","maxChapters":-3,"like":["Solo Leveling"]} ok', valid);
    expect(intent).toMatchObject({ summary: "Ação completa", includeTags: ["genre.action"], status: "complete", language: "all", maxChapters: null, like: ["Solo Leveling"] });
    expect(parseIntent("não sei", valid)).toBeNull();
  });

  it("sends the tag list to the model and uses its answer", async () => {
    const ask = vi.fn(async (_instructions: string, _text: string) => ({ text: '{"summary":"Fantasia de ação","includeTags":["genre.fantasy"]}', credits: 0.01 }));
    const result = await runSmartFilter("fantasia de ação", { index, tags, ask });
    expect(ask.mock.calls[0][0]).toContain("theme.level_system=Sistema de Nível");
    expect(result.source).toBe("ai");
    expect(result.filters.includeTags).toEqual(["genre.fantasy"]);
    expect(result.credits).toBe(0.01);
  });

  it("falls back to the local interpreter when the call fails or the answer is not JSON", async () => {
    const failing = await runSmartFilter("completa, sem harém", { index, tags, ask: async () => { throw new Error("not_logged_in"); } });
    expect(failing).toMatchObject({ source: "local", fallbackReason: "not_logged_in" });
    expect(failing.filters).toMatchObject({ status: "complete", excludeTags: ["theme.harem"] });
    const garbage = await runSmartFilter("completa", { index, tags, ask: async () => ({ text: "desculpe" }) });
    expect(garbage).toMatchObject({ source: "local", fallbackReason: "invalid_answer" });
  });

  it("keeps the instructions short and only with known tags", () => {
    const instructions = buildInstructions([...tags, tag("raw.lixo", "Lixo")]);
    expect(instructions).not.toContain("raw.lixo");
    expect(instructions.length).toBeLessThan(3000);
  });
});

describe("smart filter: curation by reading the synopses", () => {
  const storyIndex = buildCatalogIndex([
    novel("Shadow Slave", {
      tagKeys: ["genre.action", "genre.fantasy"], chapters: 2000,
      description: "Sunny, um órfão, é arrastado para o Feitiço do Pesadelo e ganha poderes de sombra."
    }),
    novel("Escravo das Sombras", { sourceId: "outra", tagKeys: ["genre.action", "genre.fantasy"] }),
    novel("Lorde das Sombras", {
      tagKeys: ["genre.action", "genre.fantasy"], status: "complete",
      description: "Um jovem amaldiçoado sobrevive em um mundo de pesadelos controlando sombras."
    }),
    novel("Herói Sorridente", {
      tagKeys: ["genre.action", "genre.fantasy"], status: "complete",
      description: "Um herói alegre salva a vila e conquista o coração da princesa."
    }),
    novel("Lorde das Sombras (EN)", {
      sourceId: "en-source", language: "en", tagKeys: ["genre.action", "genre.fantasy"],
      description: "A cursed youth survives a nightmare world by commanding shadows."
    }),
    novel("Amor de Verão", { tagKeys: ["genre.romance"], status: "complete", description: "Romance na praia." })
  ]);
  const intentAnswer = JSON.stringify({
    summary: "Parecido com Shadow Slave", like: ["Shadow Slave"],
    profile: "Protagonista órfão e cínico preso num mundo de pesadelos, com poder de sombra.",
    keywords: ["sombra", "pesadelo", "shadow", "nightmare"],
    traits: ["protagonista amaldiçoado por um feitiço", "mundo de pesadelos", "poder de sombra"]
  });

  it("pre-selects by shared story tags and synopsis keywords, one edition per work, without the reference", () => {
    const intent = parseIntent(intentAnswer, new Set(tags.map((t) => t.key)))!;
    const { seeds, filters } = applyIntent(storyIndex, intent, tags);
    const ids = selectCandidates(storyIndex, intent, seeds, filters).map((n) => n.id);
    expect(ids).not.toContain("Shadow Slave");
    // The work with the most story keywords comes first, as its Portuguese edition only.
    expect(ids[0]).toBe("Lorde das Sombras");
    expect(ids).not.toContain("Lorde das Sombras (EN)");
    expect(ids.at(-1)).toBe("Amor de Verão");
    expect(selectCandidates(storyIndex, intent, seeds, filters, 2).map((n) => n.id)).toEqual(["Lorde das Sombras", "Escravo das Sombras"]);
    // Works the model named itself go first, matched by exact title.
    const named = { ...intent, alsoLike: ["Herói Sorridente", "Obra Que Não Existe"] };
    expect(selectCandidates(storyIndex, named, seeds, filters, 2).map((n) => n.id)).toEqual(["Herói Sorridente", "Lorde das Sombras"]);
  });

  it("asks the model to read the candidates and shows only its picks, with its reasons", async () => {
    const ask = vi.fn(async (instructions: string, text: string, _effort?: string) => {
      if (instructions !== CURATION_INSTRUCTIONS) return { text: intentAnswer, credits: 0.01 };
      const id = text.match(/\[(c\d+)\] Lorde das Sombras \|/)![1];
      return {
        text: JSON.stringify({ picks: [{
          id, score: 9, reason: "Protagonista amaldiçoado num mundo de pesadelos", traits: ["T1", "T2"],
          shared: ["T1: jovem amaldiçoado", "T2: mundo de pesadelos"]
        }] }),
        credits: 0.05
      };
    });
    const stages: string[] = [];
    const result = await runSmartFilter("algo parecido com Shadow Slave", {
      index: storyIndex, tags, ask, onStage: (stage) => stages.push(stage)
    });
    expect(ask).toHaveBeenCalledTimes(2);
    const curationText = ask.mock.calls[1][1];
    expect(curationText).toContain("Perfil da história: Protagonista órfão");
    expect(curationText).toContain("Referência: Shadow Slave");
    expect(curationText).toContain("T2. mundo de pesadelos");
    expect(ask.mock.calls.map((call) => call[2])).toEqual(["low", "low"]);
    expect(curationText).toContain("mundo de pesadelos controlando sombras");
    expect(stages).toEqual(["understanding", "reading"]);
    expect(result.picks).toEqual(["Lorde das Sombras"]);
    expect(result.reasons["Lorde das Sombras"]).toBe("9/10 · Protagonista amaldiçoado num mundo de pesadelos");
    expect(result.pickNovels?.map((n) => n.id)).toEqual(["Lorde das Sombras"]);
    expect(result.scores["Lorde das Sombras"]).toBeGreaterThan(result.scores["Herói Sorridente"]);
    expect(result.credits).toBeCloseTo(0.06);
  });

  it("only curates story requests: plain filters make a single call", async () => {
    const ask = vi.fn(async () => ({ text: '{"summary":"Completas","status":"complete"}' }));
    const result = await runSmartFilter("só as completas", { index: storyIndex, tags, ask });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(result.picks).toBeUndefined();
  });

  it("keeps the tag ranking when the curation call fails", async () => {
    const ask = vi.fn(async (instructions: string) => {
      if (instructions === CURATION_INSTRUCTIONS) throw new Error("rate limited");
      return { text: intentAnswer };
    });
    const result = await runSmartFilter("parecido com Shadow Slave", { index: storyIndex, tags, ask });
    expect(result).toMatchObject({ source: "ai", curationFailed: true });
    expect(result.picks).toBeUndefined();
  });

  it("reads the picks strictly: known ids, score 7 or more, best first, no repeats, at most 12", () => {
    const candidates = Array.from({ length: 20 }, (_, i) => novel(`n${i + 1}`, {}));
    const two = ["protagonista: x", "mundo: y"];
    const many = Array.from({ length: 15 }, (_, i) => ({ id: `c${i + 1}`, score: 8, reason: "x", shared: two }));
    const answer = JSON.stringify({ picks: [
      { id: "c3", score: 6, reason: "fraco", shared: two },
      { id: "c99", score: 10, reason: "inventado", shared: two },
      { id: "c2", score: 7, reason: "ok", shared: two },
      { id: "c4", score: 9, reason: "só o gênero", shared: ["gênero: fantasia"] },
      { id: "c5", score: 9.5, reason: "melhor", shared: two },
      { id: "c5", score: 9, reason: "repetido", shared: two }
    ] });
    const parsed = parsePicks(answer, candidates)!;
    expect(parsed.ids).toEqual(["n5", "n2"]);
    expect(parsed.reasons.n5).toBe("10/10 · melhor");
    expect(parsePicks(JSON.stringify({ picks: many }), candidates)!.ids).toHaveLength(12);
    expect(parsePicks('{"picks":[]}', candidates)!.ids).toEqual([]);
    // With traits, a pick must name two real ones (T1..Tn); invented or repeated ids do not count.
    const traitAnswer = JSON.stringify({ picks: [
      { id: "c1", score: 9, traits: ["T1", "T3"], shared: two, reason: "a" },
      { id: "c2", score: 9, traits: ["T1", "t1"], shared: two, reason: "b" },
      { id: "c3", score: 9, traits: ["T1", "T9"], shared: two, reason: "c" },
      { id: "c4", score: 9, shared: two, reason: "d" }
    ] });
    expect(parsePicks(traitAnswer, candidates, 4)!.ids).toEqual(["n1"]);
    expect(parsePicks("não consegui", candidates)).toBeNull();
  });
});

describe("smart filter: the model's stray words and tags never empty the result", () => {
  it("does not filter by the free words of the answer, it only ranks with them", () => {
    const intent = parseIntent('{"summary":"Parecidas com Shadow Slave","like":["Shadow Slave"],"query":"novels parecidas"}', new Set(tags.map((t) => t.key)))!;
    const result = applyIntent(index, intent, tags);
    expect(result.filters.query).toBe("");
    expect(Object.keys(result.scores)).toHaveLength(4);
  });

  it("drops tags the model added on its own when they leave almost nothing to read", () => {
    const intent = { ...localIntent("parecido com Shadow Slave", tags), includeTags: ["genre.romance"], profile: "x" };
    const { seeds, filters } = applyIntent(index, intent, tags);
    expect(selectCandidates(index, intent, seeds, filters).map((n) => n.id)).toEqual(
      expect.arrayContaining(["Solo Leveling", "Harém do Herói", "Amor de Verão"])
    );
  });
});

describe("smart filter: explicit content", () => {
  it("leaves explicit novels out unless a reference is explicit too", () => {
    const explicitIndex = buildCatalogIndex([
      novel("Shadow Slave", { tagKeys: ["genre.action", "genre.fantasy"] }),
      novel("Smut Tutorial", { tags: ["Fantasy", "Heavy Smut"], tagKeys: ["genre.action", "genre.fantasy"] }),
      novel("Leitor Onisciente", { tags: ["Ação", "Adulto"], tagKeys: ["genre.action", "genre.fantasy"] })
    ]);
    const intent = { ...localIntent("parecido com Shadow Slave", tags), profile: "x" };
    const { seeds, filters } = applyIntent(explicitIndex, intent, tags);
    // "Adulto" (mature themes) stays; only explicit sexual content goes.
    expect(selectCandidates(explicitIndex, intent, seeds, filters).map((n) => n.id)).toEqual(["Leitor Onisciente"]);
  });
});
