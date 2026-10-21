import { describe, expect, it } from "vitest";
import { buildLibraryItems } from "../app/useLocalLibrary";
import type { BookSeries, LibraryItem, LibraryMeta } from "../core/types";
import { compareVolumes, isImported, seriesOfSnapshot, stackLibrary, volumesOf } from "../features/library/seriesModel";
import { mapLibraryRow, novelMetaKey, type LocalLibraryEntry } from "../services/localFiles";

const SHA = "a".repeat(64);
const unsheathed = (volume: number | null): BookSeries => ({ id: "series:unsheathed", name: "Unsheathed", volume });

const book = (id: string, overrides: Partial<LibraryItem> = {}): LibraryItem =>
  ({ id, title: id, author: "", format: "EPUB", formats: ["EPUB"], chapters: 0, sizeMb: 1, coverClass: "", exportedAt: "", ...overrides }) as LibraryItem;

const titles = (items: LibraryItem[]) => items.map((item) => item.title);

describe("series in the library", () => {
  it("groups volumes with the same series id into one card, even with edition stacks off", () => {
    const items = [
      book("solo"),
      book("v3", { title: "Fallen Star", series: unsheathed(3) }),
      book("other", { title: "Outra", series: { id: "series:outra", name: "Outra", volume: 1 } }),
      book("v1", { title: "Caged Sparrow", series: unsheathed(1) }),
      book("v2", { title: "Broken Wings", series: unsheathed(2) })
    ];
    const cards = stackLibrary(items, null);
    expect(cards.map((card) => card.key)).toEqual(["item:solo", "series:series:unsheathed", "item:other"]);
    const series = cards[1];
    expect(series.series).toEqual(unsheathed(3));
    // The card keeps the place of the series' first book; its face is volume 1.
    expect(series.main.id).toBe("v1");
    expect(titles(series.items)).toEqual(["Caged Sparrow", "Broken Wings", "Fallen Star"]);
    // A series with one volume in the library is a plain book card.
    expect(cards[2].series).toBeUndefined();
  });

  it("orders volumes by number (2 before 10, 2.5 between), then title, and those without a number last", () => {
    const items = [
      book("x", { title: "Extra", series: unsheathed(null) }),
      book("ten", { title: "Dez", series: unsheathed(10) }),
      book("b", { title: "B", series: unsheathed(2) }),
      book("half", { title: "Meio", series: unsheathed(2.5) }),
      book("a", { title: "A", series: unsheathed(2) }),
      book("one", { title: "Um", series: unsheathed(1) })
    ];
    expect(titles([...items].sort(compareVolumes))).toEqual(["Um", "A", "B", "Meio", "Dez", "Extra"]);
    expect(titles(stackLibrary(items, null)[0].items)).toEqual(["Um", "A", "B", "Meio", "Dez", "Extra"]);
  });

  it("never mixes a series with edition stacks and leaves separated volumes alone", () => {
    const items = [
      book("v1", { title: "Unsheathed", series: unsheathed(1) }),
      book("same-title", { title: "Unsheathed" }),
      book("v2", { title: "Vol 2", series: unsheathed(2) })
    ];
    const byTitle = (item: LibraryItem) => [`t:${item.title.toLowerCase()}`];
    expect(stackLibrary(items, byTitle).map((card) => card.items.map((item) => item.id))).toEqual([["v1", "v2"], ["same-title"]]);
    expect(stackLibrary(items, byTitle, new Set(["v2"])).map((card) => card.items.length)).toEqual([1, 1, 1]);
  });

  it("lists the visible volumes of a series in order", () => {
    const library = [
      book("v2", { series: unsheathed(2) }),
      book("hidden", { series: unsheathed(3), hidden: true }),
      book("v1", { series: unsheathed(1) }),
      book("solo")
    ];
    expect(volumesOf(library, "series:unsheathed").map((item) => item.id)).toEqual(["v1", "v2"]);
  });

  it("reads the series from an import: row snapshot and ignores malformed ones", () => {
    expect(seriesOfSnapshot({ novelId: "", title: "", series: unsheathed(1) })).toEqual(unsheathed(1));
    expect(seriesOfSnapshot({ novelId: "", title: "", series: { id: "series:x", name: "X", volume: Number.NaN } })).toEqual({ id: "series:x", name: "X", volume: null });
    expect(seriesOfSnapshot({ novelId: "", title: "", series: { id: "", name: "X", volume: 1 } })).toBeUndefined();
    expect(seriesOfSnapshot({ novelId: "", title: "" })).toBeUndefined();
    expect(seriesOfSnapshot(null)).toBeUndefined();
  });

  it("an imported folder joins its import: row (series, marks) and is not taken for a translation", () => {
    expect(novelMetaKey(`import:${SHA}`)).toBe(`import:${SHA}`);
    expect(novelMetaKey("cn:1")).toBe("novel:cn:1");
    const entry: LocalLibraryEntry = mapLibraryRow({
      title: "Caged Sparrow",
      outputDir: "/o/Unsheathed - Vol 1 - Caged Sparrow",
      files: ["Caged Sparrow.epub"],
      sizeBytes: 1878579,
      novelId: `import:${SHA}`,
      language: "pt-BR"
    }, null);
    expect(entry.language).toBeUndefined();
    const meta: LibraryMeta[] = [{
      key: `import:${SHA}`,
      favorite: true,
      readingStatus: "reading",
      tags: [],
      hidden: false,
      onShelf: true,
      private: true,
      snapshot: { origin: "import", title: "Caged Sparrow", series: unsheathed(1) } as LibraryMeta["snapshot"]
    }];
    const [item] = buildLibraryItems([entry], meta, []);
    expect(item).toMatchObject({ novelId: `import:${SHA}`, favorite: true, readingStatus: "reading", series: unsheathed(1) });
    expect(item.language).toBeUndefined();
    expect(isImported(item)).toBe(true);
    expect(isImported(book("cn", { novelId: "cn:1" }))).toBe(false);
  });
});
