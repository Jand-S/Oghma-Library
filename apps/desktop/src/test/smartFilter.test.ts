import { describe, expect, it, vi } from "vitest";
import type { Novel, TagCatalogItem } from "../core/types";
import { buildCatalogIndex } from "../services/catalogIndex";
import { applyIntent, buildInstructions, localIntent, parseIntent, runSmartFilter } from "../services/smartFilter";

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
    const ask = vi.fn(async (_instructions: string, _text: string) => ({ text: '{"summary":"Fantasia de ação","includeTags":["genre.fantasy"],"like":["Shadow Slave"]}', credits: 0.01 }));
    const result = await runSmartFilter("algo tipo shadow slave", { index, tags, ask });
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
