import { describe, expect, it } from "vitest";
import type { LibraryItem, LibraryMeta, Novel } from "../core/types";
import type { LocalLibraryEntry } from "../services/localFiles";
import { buildLibraryItems, enrichLibraryItems, shelfAdditions } from "../app/useLocalLibrary";
import { filterLibrary, formatsOf, statusCounts } from "../features/library/libraryModel";
import { homeSeeds, seedWeight } from "../features/home/HomeView";
import { buildCatalogIndex, similarNovels } from "../services/catalogIndex";

function novel(partial: Partial<Novel> & Pick<Novel, "id" | "title">): Novel {
  return {
    author: "Autor",
    sourceId: "cn",
    sourceName: "Central Novel",
    tags: [],
    tagKeys: [],
    status: "ongoing",
    chapters: 10,
    language: "pt-BR",
    updatedAt: "",
    description: "desc",
    coverClass: "cover-a",
    ...partial
  };
}

function meta(partial: Partial<LibraryMeta> & Pick<LibraryMeta, "key">): LibraryMeta {
  return { favorite: false, readingStatus: "unread", tags: [], hidden: false, ...partial };
}

function entry(partial: Partial<LocalLibraryEntry> & Pick<LocalLibraryEntry, "title" | "outputDir">): LocalLibraryEntry {
  return { folderName: partial.title, files: ["book.epub"], sizeBytes: 2 * 1024 * 1024, ...partial };
}

describe("shelf (books without files)", () => {
  const catalog = [novel({ id: "cn:1", title: "Shadow Slave", chapters: 2000, coverUrl: "https://c/1.jpg" })];

  it("lists shelf rows next to downloaded books, from the catalog or from the snapshot", () => {
    const rows = [
      meta({ key: "novel:cn:1", onShelf: true, rating: 5, readingStatus: "completed", addedAt: 10 }),
      meta({ key: "novel:gone:9", onShelf: true, snapshot: { novelId: "gone:9", title: "Fonte Fechada", sourceName: "Lunar" } }),
      meta({ key: "novel:cn:2", onShelf: false }),
      meta({ key: "novel:cn:3", onShelf: true, deletedAt: 50 }),
      meta({ key: "novel:cn:4", onShelf: true })
    ];
    const disk = [entry({ title: "Baixado", outputDir: "/out/Baixado", novelId: "cn:4" })];
    const items = buildLibraryItems(disk, rows, catalog);

    expect(items.map((item) => [item.id, item.availability])).toEqual([
      ["local-/out/Baixado", "local"],
      ["shelf-cn:1", "shelf"],
      ["shelf-gone:9", "shelf"]
    ]);
    const shadow = items[1];
    expect(shadow).toMatchObject({ title: "Shadow Slave", chapters: 2000, rating: 5, readingStatus: "completed", unavailable: false });
    expect(formatsOf(shadow)).toEqual([]);
    expect(items[2]).toMatchObject({ title: "Fonte Fechada", sourceName: "Lunar", unavailable: true });
  });

  it("re-resolves a shelf book when the catalog arrives later", () => {
    const rows = [meta({ key: "novel:cn:1", onShelf: true, snapshot: { novelId: "cn:1", title: "Shadow Slave (velho)" } })];
    const before = buildLibraryItems([], rows, []);
    expect(before[0]).toMatchObject({ title: "Shadow Slave (velho)", unavailable: true });
    const after = enrichLibraryItems(before, [], catalog);
    expect(after[0]).toMatchObject({ title: "Shadow Slave", unavailable: false, chapters: 2000 });
  });

  it("adds untracked downloads to the shelf, but respects removals and translations", () => {
    const disk = [
      entry({ title: "Novo", outputDir: "/out/Novo", novelId: "cn:1", mtimeMs: 100 }),
      entry({ title: "Removido", outputDir: "/out/Removido", novelId: "cn:5", mtimeMs: 100 }),
      entry({ title: "Rebaixado", outputDir: "/out/Rebaixado", novelId: "cn:6", mtimeMs: 300 }),
      entry({ title: "Oculto", outputDir: "/out/Oculto", novelId: "cn:7" }),
      entry({ title: "PT-BR", outputDir: "/out/PT", novelId: "cn:8", language: "pt-BR" }),
      entry({ title: "Já na estante", outputDir: "/out/Ja", novelId: "cn:9" })
    ];
    const rows = [
      meta({ key: "novel:cn:5", deletedAt: 200 }),
      meta({ key: "novel:cn:6", deletedAt: 200 }),
      meta({ key: "novel:cn:7", hidden: true }),
      meta({ key: "novel:cn:9", onShelf: true })
    ];
    const added = shelfAdditions(disk, rows, catalog, 999);
    expect(added.map((row) => row.key)).toEqual(["novel:cn:1", "novel:cn:6"]);
    expect(added[0]).toMatchObject({ onShelf: true, addedAt: 100, snapshot: { novelId: "cn:1", title: "Shadow Slave", coverUrl: "https://c/1.jpg" } });
  });
});

describe("removing a downloaded book", () => {
  const catalog = [novel({ id: "cn:1", title: "Shadow Slave" })];

  it("hides it here (files kept, in Ocultos) with what the reader marked, until it is downloaded again", () => {
    const disk = [entry({ title: "Shadow Slave", outputDir: "/out/Shadow Slave", novelId: "cn:1", mtimeMs: 100 })];
    const tomb = meta({ key: "novel:cn:1", deletedAt: 200, rating: 5, readingStatus: "completed", favorite: true });
    const [removed] = buildLibraryItems(disk, [tomb], catalog);
    expect(removed).toMatchObject({ availability: "local", hidden: true, rating: 5, readingStatus: "completed", favorite: true });
    // Downloaded again after the removal: back in the library (and re-added to the account).
    const again = [entry({ title: "Shadow Slave", outputDir: "/out/Shadow Slave", novelId: "cn:1", mtimeMs: 300 })];
    expect(buildLibraryItems(again, [tomb], catalog)[0].hidden).toBe(false);
    expect(shelfAdditions(again, [tomb], catalog).map((row) => row.key)).toEqual(["novel:cn:1"]);
    expect(shelfAdditions(disk, [tomb], catalog)).toEqual([]);
  });

  it("also hides a book matched to the catalog by title (no id in its folder)", () => {
    const disk = [entry({ title: "Shadow Slave", outputDir: "/out/Shadow Slave", mtimeMs: 100 })];
    expect(buildLibraryItems(disk, [meta({ key: "novel:cn:1", deletedAt: 200 })], catalog)[0].hidden).toBe(true);
  });
});

describe("library filters", () => {
  const items = [
    { id: "a", title: "A", rating: 3, readingStatus: "reading", availability: "local" },
    { id: "b", title: "B", rating: 5, readingStatus: "completed", availability: "shelf" },
    { id: "c", title: "C", readingStatus: "dropped", availability: "local" },
    { id: "d", title: "D", readingStatus: "reading", availability: "local", hidden: true }
  ].map((partial) => ({ author: "", format: "EPUB", chapters: 1, sizeMb: 1, coverClass: "", exportedAt: "Local", ...partial }) as LibraryItem);

  it("filters by status chip and sorts by rating", () => {
    const base = { query: "", formats: new Set<never>(), favoritesOnly: false };
    expect(filterLibrary(items, { ...base, status: "reading", sort: "recent" }).map((item) => item.id)).toEqual(["a"]);
    expect(filterLibrary(items, { ...base, status: "shelf", sort: "recent" }).map((item) => item.id)).toEqual(["b"]);
    expect(filterLibrary(items, { ...base, status: "all", sort: "rating" }).map((item) => item.id)).toEqual(["b", "a", "c"]);
    expect(statusCounts(items)).toMatchObject({ all: 3, reading: 1, completed: 1, dropped: 1, shelf: 1, paused: 0 });
  });
});

describe("ratings in the recommendations", () => {
  const book = (partial: Partial<LibraryItem>) =>
    ({ id: "x", title: "x", author: "", format: "EPUB", chapters: 1, sizeMb: 1, coverClass: "", exportedAt: "", ...partial }) as LibraryItem;

  it("weighs stars above favorite and status, and turns low ratings and drops negative", () => {
    expect(seedWeight(book({ rating: 5 }))).toBe(3);
    expect(seedWeight(book({ rating: 4, favorite: true }))).toBe(4);
    expect(seedWeight(book({ readingStatus: "reading" }))).toBe(1.5);
    expect(seedWeight(book({}))).toBe(0.25);
    expect(seedWeight(book({ rating: 2, favorite: true }))).toBe(-1);
    expect(seedWeight(book({ readingStatus: "dropped" }))).toBe(-1);
    // Dropped but still rated well: the rating wins.
    expect(seedWeight(book({ readingStatus: "dropped", rating: 4 }))).toBe(2);
  });

  it("orders seeds by weight and keeps disliked books apart", () => {
    const index = buildCatalogIndex([novel({ id: "a", title: "A" }), novel({ id: "b", title: "B" }), novel({ id: "c", title: "C" })]);
    const { seeds, weights, avoid } = homeSeeds([
      book({ novelId: "a", rating: 3 }),
      book({ novelId: "b", rating: 5 }),
      book({ novelId: "c", rating: 1 })
    ], index);
    expect(seeds.map((seed) => seed.id)).toEqual(["b", "a"]);
    expect(weights).toEqual([3, 0.5]);
    expect(avoid.map((novel) => novel.id)).toEqual(["c"]);
  });

  it("sinks novels close to a disliked book", () => {
    const tags = (...keys: string[]) => ({ tagKeys: keys.map((key) => `genre.${key}`) });
    const index = buildCatalogIndex([
      novel({ id: "liked", title: "Liked", ...tags("fantasy", "magic", "academy") }),
      novel({ id: "disliked", title: "Disliked", ...tags("harem", "romance", "school") }),
      novel({ id: "close-to-liked", title: "Close", ...tags("fantasy", "magic", "academy", "romance") }),
      novel({ id: "mixed", title: "Mixed", ...tags("fantasy", "magic", "harem", "romance", "school") })
    ]);
    const seeds = [index.byId.get("liked")!];
    const plain = similarNovels(index, seeds, { limit: 5 }).map((novel) => novel.id);
    expect(plain).toContain("mixed");
    const steered = similarNovels(index, seeds, { limit: 5, avoid: [index.byId.get("disliked")!] }).map((novel) => novel.id);
    expect(steered).toContain("close-to-liked");
    expect(steered).not.toContain("mixed");
  });
});
