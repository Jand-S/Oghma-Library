import { describe, expect, it } from "vitest";
import { defaultFilters } from "../core/defaults";
import { tagKeysForNovel } from "../core/tagFilters";
import type { Novel } from "../core/types";
import { buildCatalogIndex, editionsOf, searchCatalog, similarNovels, sortNovels } from "../services/catalogIndex";

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

describe("discovery helpers", () => {
  const books = [
    novel("ss-cn", { title: "Shadow Slave", tagKeys: ["genre.action", "genre.fantasy", "theme.level_system", "format.webnovel"], chapters: 2000 }),
    novel("ss-gn", { title: "Shadow Slave (Novel)", sourceId: "golden-novel", language: "en", tagKeys: ["genre.action"], chapters: 2300 }),
    novel("lotm", { title: "Lord of the Mysteries", tagKeys: ["genre.action", "genre.fantasy", "genre.mystery"], chapters: 1400 }),
    novel("solo", { title: "Solo Leveling", tagKeys: ["genre.action", "theme.level_system", "genre.fantasy"], chapters: 270 }),
    novel("romance", { title: "Amor de Verão", tagKeys: ["genre.romance", "genre.slice_of_life"] })
  ];
  const idx = buildCatalogIndex(books);

  it("finds the same work in other sources, most complete first", () => {
    expect(editionsOf(idx, books[0]).map((n) => n.id)).toEqual(["ss-gn"]);
    expect(editionsOf(idx, books[2])).toEqual([]);
  });

  it("suggests novels sharing story tags, never the seed or its other editions", () => {
    expect(similarNovels(idx, [books[0]]).map((n) => n.id)).toEqual(["solo", "lotm"]);
    expect(similarNovels(idx, [books[0]], { exclude: new Set(["solo"]) }).map((n) => n.id)).toEqual(["lotm"]);
    expect(similarNovels(idx, [books[4]])).toEqual([]);
  });

  it("uses the server's story list when there is one, and the tags only as a fallback", () => {
    const withList = {
      ...buildCatalogIndex([...books, novel("lotm-pt", { title: "O Senhor dos Mistérios", sourceId: "novel-mania", chapters: 1400 })]),
      discovery: {
        similar: new Map<string, Array<[string, number]>>([
          ["ss-cn", [["romance", 0.9], ["lotm", 0.8], ["ss-gn", 0.7], ["solo", 0.5]]],
          ["lotm", [["romance", 0.6]]]
        ]),
        editions: new Map([["lotm", ["lotm-pt"]], ["lotm-pt", ["lotm"]]])
      }
    };
    // Server order (even against the tags), never the seed's other editions.
    expect(similarNovels(withList, [withList.byId.get("ss-cn")!]).map((n) => n.id)).toEqual(["romance", "lotm", "solo"]);
    // A suggestion from a disabled source shows its edition in an enabled one.
    expect(similarNovels(withList, [withList.byId.get("ss-cn")!], { sourceIds: ["novel-mania", "central-novel"] }).map((n) => n.id))
      .toEqual(["romance", "lotm", "solo"]);
    expect(similarNovels(withList, [withList.byId.get("ss-cn")!], { sourceIds: ["novel-mania"] }).map((n) => n.id)).toEqual(["lotm-pt"]);
    // Several seeds add up; a seed without a list falls back to the tags for everyone.
    expect(similarNovels(withList, [withList.byId.get("ss-cn")!, withList.byId.get("lotm")!]).map((n) => n.id)[0]).toBe("romance");
    expect(similarNovels(withList, [withList.byId.get("solo")!]).map((n) => n.id)).toEqual(["ss-cn", "lotm"]);
    // Translations the title cannot match come from the server.
    expect(editionsOf(withList, withList.byId.get("lotm")!).map((n) => n.id)).toEqual(["lotm-pt"]);
  });

  it("sorts by updates, arrivals, size, popularity and rating; missing data goes last", () => {
    const dated = [
      novel("old", { title: "B", lastChapterAt: "2026-01-01T00:00:00Z", views: 10, rating: 4.9, ratingVotes: 2 }),
      novel("fresh", { title: "C", lastChapterAt: "2026-10-01T00:00:00Z", views: 500, rating: 4.9, ratingVotes: 90 }),
      novel("none", { title: "A" })
    ];
    expect(sortNovels(dated, "updated").map((n) => n.id)).toEqual(["fresh", "old", "none"]);
    expect(sortNovels(dated, "popular").map((n) => n.id)).toEqual(["fresh", "old", "none"]);
    expect(sortNovels(dated, "rating").map((n) => n.id)).toEqual(["fresh", "old", "none"]);
    expect(sortNovels(dated, "title", "desc").map((n) => n.id)).toEqual(["fresh", "old", "none"]);
  });
});
