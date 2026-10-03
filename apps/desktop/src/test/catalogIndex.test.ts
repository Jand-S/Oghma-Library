import { describe, expect, it } from "vitest";
import { defaultFilters } from "../core/defaults";
import { tagKeysForNovel } from "../core/tagFilters";
import type { Novel } from "../core/types";
import { buildCatalogIndex, searchCatalog } from "../services/catalogIndex";

function novel(id: string, patch: Partial<Novel>): Novel {
  return {
    id, title: id, author: "", sourceId: "central-novel", sourceName: "Central Novel", tags: [], tagKeys: [],
    status: "ongoing", chapters: 100, language: "pt-BR", updatedAt: "", description: "", coverClass: "", ...patch
  };
}

const novels = [
  novel("a", { title: "Martial Peak", tags: ["Cultivo", "Ação"], tagKeys: ["genre.cultivation", "genre.action"], description: "Um jovem discípulo." }),
  novel("b", { title: "Ação no Céu", sourceId: "novel-mania", description: "História de aventura." }),
  novel("c", { title: "Shadow Slave", author: "Guiltythree", description: "Sunny tenta sobreviver ao cultivo do pesadelo.", sourceId: "golden-novel", language: "en" }),
  novel("d", { title: "Cultivo Eterno", sourceId: "golden-novel", status: "complete" })
];
const index = buildCatalogIndex(novels);
const search = (query: string, patch: Partial<ReturnType<typeof defaultFilters>> = {}, sourceIds?: string[]) =>
  searchCatalog(index, { ...defaultFilters(), query, ...patch }, sourceIds).map((n) => n.id);

describe("catalog search", () => {
  it("finds a tag, the synopsis and the title, title matches first", () => {
    // "cultivo" used to return nothing: the search only looked at title and author.
    expect(search("cultivo")).toEqual(["d", "a", "c"]);
  });

  it("ignores accents and case", () => {
    expect(search("acao")).toEqual(["b", "a"]);
    expect(search("SHADOW")).toEqual(["c"]);
    expect(search("guiltythree")).toEqual(["c"]);
  });

  it("matches the start of words, not the middle", () => {
    // "Fundação" normalizes to "fundacao", which contains "acao": it must not match.
    const extra = buildCatalogIndex([...novels, novel("e", { title: "A Fundação" })]);
    expect(searchCatalog(extra, { ...defaultFilters(), query: "acao" }).map((n) => n.id)).toEqual(["b", "a"]);
    expect(search("cultiv")).toEqual(["d", "a", "c"]);
  });

  it("every word must match somewhere", () => {
    expect(search("martial cultivo")).toEqual(["a"]);
    expect(search("martial dragao")).toEqual([]);
  });

  it("searches every enabled source at once, or a single chosen one", () => {
    expect(search("", {}, ["central-novel", "golden-novel"]).sort()).toEqual(["a", "c", "d"]);
    expect(search("", { sourceId: "novel-mania" }, ["central-novel"])).toEqual(["b"]);
  });

  it("keeps the other filters", () => {
    expect(search("cultivo", { status: "complete" })).toEqual(["d"]);
    expect(search("", { language: "en" })).toEqual(["c"]);
    expect(search("", { includeTags: ["genre.cultivation"] })).toEqual(["a"]);
  });

  it("does not pair tag labels with keys by position", () => {
    // Python drops duplicate/empty tags from tagKeys, so the lists can be out of step.
    const keys = tagKeysForNovel({ tags: ["Ação", "Action", "Foo"], tagKeys: ["genre.action", "raw.foo"] });
    expect(keys).toContain("raw.foo");
    expect(keys.filter((key) => key === "genre.action")).toHaveLength(1);
  });
});
