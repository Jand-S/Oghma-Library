import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../core/types";
import { shareableLibraryBooks } from "../features/social/socialEnv";

function item(novelId: string, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: `local-${novelId}`,
    novelId,
    title: `Livro ${novelId}`,
    author: "Autor",
    format: "EPUB",
    formats: ["EPUB"],
    chapters: 0,
    sizeMb: 1,
    coverClass: "cover-c",
    exportedAt: "Local",
    availability: "local",
    ...overrides
  };
}

describe("library books a friend can be shown", () => {
  it("keeps imported books out: they are always private", () => {
    const imported = item(`import:${"a".repeat(64)}`, { language: undefined });
    const shelfImport = item(`import:${"b".repeat(64)}`, { availability: "shelf", outputDir: undefined, formats: [] });
    const catalog = item("cn:1");
    const books = shareableLibraryBooks([imported, shelfImport, catalog], () => undefined);
    expect(books.map((book) => book.novelId)).toEqual(["cn:1"]);
  });

  it("still leaves out translations and hidden books", () => {
    const books = shareableLibraryBooks([item("cn:1", { language: "pt-BR" }), item("cn:2", { hidden: true }), item("cn:3")], () => undefined);
    expect(books).toEqual([{ novelId: "cn:3", snapshot: { novelId: "cn:3", title: "Livro cn:3", author: "Autor", sourceName: undefined, coverUrl: undefined } }]);
  });
});
