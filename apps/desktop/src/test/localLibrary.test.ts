import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig, LibraryItem, LibraryMeta, Novel } from "../core/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  convertFileSrc: (path: string) => `asset://localhost/${encodeURIComponent(path)}`
}));

const dialogOpen = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...args: unknown[]) => dialogOpen(...args) }));

import {
  deleteLibraryMetadata,
  listLocalLibrary,
  mapLibraryRow,
  pickDirectory,
  pickExportRoot,
  saveLibraryMetadata,
  type ExportLibraryRow,
  type LocalLibraryEntry
} from "../services/localFiles";
import { buildLibraryItems, enrichLibraryItems, findCatalogNovel, useLocalLibrary } from "../app/useLocalLibrary";

const convert = (path: string) => `asset://localhost/${encodeURIComponent(path)}`;

function novel(partial: Partial<Novel> & Pick<Novel, "id" | "title">): Novel {
  return {
    author: "Autor",
    sourceId: "cn",
    sourceName: "Central Novel",
    tags: [],
    tagKeys: [],
    status: "ongoing" as Novel["status"],
    chapters: 10,
    language: "pt-BR",
    updatedAt: "",
    description: "desc",
    coverClass: "cover-a",
    ...partial
  };
}

function entry(partial: Partial<LocalLibraryEntry> & Pick<LocalLibraryEntry, "title" | "outputDir">): LocalLibraryEntry {
  return { folderName: partial.title, files: ["book.epub"], sizeBytes: 2 * 1024 * 1024, ...partial };
}

const row: ExportLibraryRow = {
  title: "Solo Leveling: Ragnarök",
  folderName: "Solo Leveling_ Ragnarök",
  outputDir: "/out/Solo Leveling_ Ragnarök",
  files: ["Solo Leveling_ Ragnarök.epub"],
  coverPath: "/out/Solo Leveling_ Ragnarök/cover.jpg",
  coverDataUrl: null,
  sizeBytes: 1024,
  mtimeMs: 1700000000000,
  novelId: "cn:42",
  generatedAt: null,
  chapterCount: 12,
  sourceChars: null,
  wordCount: null,
  analysisFormat: null
};

function setTauri(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>;
  if (enabled) target.__TAURI_INTERNALS__ = {};
  else delete target.__TAURI_INTERNALS__;
}

beforeEach(() => {
  invokeMock.mockReset();
  dialogOpen.mockReset();
});

afterEach(() => setTauri(false));

describe("mapLibraryRow", () => {
  it("uses the asset protocol with mtime cache-busting", () => {
    const mapped = mapLibraryRow(row, convert);
    expect(mapped.coverUrl).toBe(`${convert(row.coverPath as string)}?v=1700000000000`);
    expect(mapped.novelId).toBe("cn:42");
    expect(mapped.title).toBe("Solo Leveling: Ragnarök");
    expect(mapped.folderName).toBe("Solo Leveling_ Ragnarök");
    expect(mapped.chapterCount).toBe(12);
    expect(mapped.sourceChars).toBeUndefined();
  });

  it("falls back to the data URL without a cover path or asset support", () => {
    const withData = { ...row, coverDataUrl: "data:image/jpeg;base64,AA==" };
    expect(mapLibraryRow(withData, null).coverUrl).toBe("data:image/jpeg;base64,AA==");
    expect(mapLibraryRow({ ...row, coverPath: null }, convert).coverUrl).toBeUndefined();
    expect(mapLibraryRow({ ...row, folderName: undefined }, convert).folderName).toBe(row.title);
  });
});

describe("catalog enrichment", () => {
  const catalog = [
    novel({ id: "cn:1", title: "Solo Leveling: Ragnarök", author: "Title Match" }),
    novel({ id: "cn:42", title: "Nome diferente no catálogo", author: "Id Match" }),
    novel({ id: "cn:7", title: "A Lenda: Heroi", author: "Legacy Match" })
  ];

  it("matches by novelId before the title", () => {
    const found = findCatalogNovel(entry({ title: "Solo Leveling: Ragnarök", outputDir: "/o/a", novelId: "cn:42" }), catalog);
    expect(found?.author).toBe("Id Match");
  });

  it("matches a book downloaded under an old id after the site moved the novel", () => {
    const moved = [...catalog, novel({ id: "cn:shadow-new", title: "Shadow Slave", author: "Moved", aliases: ["cn:shadow-old"] })];
    expect(findCatalogNovel(entry({ title: "Shadow Slave", outputDir: "/o/s", novelId: "cn:shadow-old" }), moved)?.author).toBe("Moved");
  });

  it("does not guess by title when the manifest id is unknown", () => {
    expect(findCatalogNovel(entry({ title: "Solo Leveling: Ragnarök", outputDir: "/o/a", novelId: "cn:999" }), catalog)).toBeUndefined();
  });

  it("falls back to sanitized and accent-insensitive titles for legacy folders", () => {
    expect(findCatalogNovel(entry({ title: "A Lenda_ Heroi", outputDir: "/o/b" }), catalog)?.id).toBe("cn:7");
    expect(findCatalogNovel(entry({ title: "solo leveling: ragnarok", outputDir: "/o/c" }), catalog)?.id).toBe("cn:1");
  });

  it("builds items with manifest title, novel-key metadata and flags hidden rows", () => {
    const entries = [
      entry({ title: "Solo Leveling: Ragnarök", outputDir: "/o/a", novelId: "cn:42", coverUrl: "asset://a" }),
      entry({ title: "Legado", outputDir: "/o/legacy" }),
      entry({ title: "Oculto", outputDir: "/o/hidden", novelId: "cn:9" })
    ];
    const meta: LibraryMeta[] = [
      { key: "/o/a", favorite: false, readingStatus: "unread", tags: [], hidden: true },
      { key: "novel:cn:42", favorite: true, readingStatus: "reading", tags: ["x"], hidden: false },
      { key: "/o/legacy", favorite: true, readingStatus: "completed", tags: [], hidden: false },
      { key: "novel:cn:9", favorite: false, readingStatus: "unread", tags: [], hidden: true }
    ];
    const items = buildLibraryItems(entries, meta, catalog);
    // Hidden books stay in the list (the Library's "Ocultos" chip brings them back), flagged.
    expect(items.filter((item) => !item.hidden).map((item) => item.title)).toEqual(["Solo Leveling: Ragnarök", "Legado"]);
    expect(items.filter((item) => item.hidden).map((item) => item.title)).toEqual(["Oculto"]);
    expect(items[0]).toMatchObject({
      id: "local-/o/a",
      novelId: "cn:42",
      author: "Id Match",
      favorite: true,
      readingStatus: "reading",
      coverUrl: "asset://a",
      sizeMb: 2
    });
    expect(items[1]).toMatchObject({ favorite: true, readingStatus: "completed", author: "" });
  });

  it("re-enriches listed items without touching metadata", () => {
    const entries = [entry({ title: "Legado", outputDir: "/o/legacy" })];
    const [item] = buildLibraryItems(entries, [], []);
    const favorite: LibraryItem = { ...item, favorite: true };
    const next = enrichLibraryItems([favorite], entries, [novel({ id: "cn:5", title: "Legado", author: "Novo Autor" })]);
    expect(next[0]).toMatchObject({ author: "Novo Autor", novelId: "cn:5", favorite: true });
    expect(enrichLibraryItems(next, entries, [])).toBe(next);
  });
});

describe("Tauri calls", () => {
  it("tells Rust the output root once before using it, and the Rust dialog sets it directly", async () => {
    setTauri(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_export_library") return [];
      if (command === "export_root_pick") return "/Users/me/Livros";
      return undefined;
    });
    await listLocalLibrary("/root/a");
    await listLocalLibrary("/root/a");
    const commands = invokeMock.mock.calls.map(([command]) => command);
    expect(commands).toEqual(["export_root_set", "list_export_library", "list_export_library"]);
    expect(invokeMock).toHaveBeenCalledWith("export_root_set", { path: "/root/a" });

    invokeMock.mockClear();
    expect(await pickExportRoot({ title: "Pasta" })).toBe("/Users/me/Livros");
    await listLocalLibrary("/Users/me/Livros");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["export_root_pick", "list_export_library"]);
  });

  it("a folder Rust refuses is not used", async () => {
    setTauri(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "export_root_set") throw new Error("Essa pasta já tem outros arquivos.");
      return [];
    });
    await expect(listLocalLibrary("/Users/me/Documents")).rejects.toThrow("outros arquivos");
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual(["export_root_set"]);
  });

  it("lists without base64 covers and translates metadata keys to novel ids", async () => {
    setTauri(true);
    invokeMock.mockImplementation(async (command: string) => (command === "list_export_library" ? [row] : undefined));
    const entries = await listLocalLibrary("~/out");
    expect(invokeMock).toHaveBeenCalledWith("list_export_library", { outputDir: "~/out", includeCoverData: false });
    expect(entries?.[0].coverUrl).toContain("?v=1700000000000");

    const meta: LibraryMeta = { key: row.outputDir, favorite: true, readingStatus: "reading", tags: [], hidden: true };
    await saveLibraryMetadata(meta);
    expect(invokeMock).toHaveBeenLastCalledWith("save_library_meta", {
      meta: { ...meta, key: "novel:cn:42" },
      legacyKey: row.outputDir
    });

    await saveLibraryMetadata({ ...meta, key: "/elsewhere" });
    expect(invokeMock).toHaveBeenLastCalledWith("save_library_meta", { meta: { ...meta, key: "/elsewhere" } });

    await deleteLibraryMetadata(row.outputDir);
    expect(invokeMock).toHaveBeenCalledWith("delete_library_meta", { key: row.outputDir });
    expect(invokeMock).toHaveBeenLastCalledWith("delete_library_meta", { key: "novel:cn:42" });
  });

  it("pickDirectory returns null outside Tauri and the selection inside", async () => {
    expect(await pickDirectory()).toBeNull();
    setTauri(true);
    dialogOpen.mockResolvedValueOnce("/Users/me/Livros");
    expect(await pickDirectory()).toBe("/Users/me/Livros");
    expect(dialogOpen).toHaveBeenCalledWith(expect.objectContaining({ directory: true, multiple: false }));
    dialogOpen.mockResolvedValueOnce(null);
    expect(await pickDirectory()).toBeNull();
  });
});

describe("useLocalLibrary", () => {
  const appConfig = { outputPath: "~/out" } as AppConfig;

  it("scans once, ignores catalog changes for disk scans, and rescans on focus and refresh", async () => {
    setTauri(true);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "list_export_library") return [row];
      if (command === "list_library_meta") return [];
      if (command === "cleanup_export_root") return 0;
      return undefined;
    });
    let library: LibraryItem[] = [];
    const setLibrary = vi.fn((update: LibraryItem[] | ((current: LibraryItem[]) => LibraryItem[])) => {
      library = typeof update === "function" ? update(library) : update;
    });
    const scans = () => invokeMock.mock.calls.filter(([command]) => command === "list_export_library").length;

    const { result, rerender } = renderHook((props: { results: Novel[] }) =>
      useLocalLibrary({ appConfig, loading: false, results: props.results, setLibrary }), { initialProps: { results: [] as Novel[] } });
    await waitFor(() => expect(library).toHaveLength(1));
    expect(scans()).toBe(1);
    expect(invokeMock).toHaveBeenCalledWith("cleanup_export_root", { outputRoot: "~/out" });
    expect(library[0].author).toBe("");

    rerender({ results: [novel({ id: "cn:42", title: "Qualquer", author: "Autora" })] });
    await waitFor(() => expect(library[0].author).toBe("Autora"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(scans()).toBe(1);

    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow + 10_000);
    try {
      act(() => { window.dispatchEvent(new Event("focus")); });
      await waitFor(() => expect(scans()).toBe(2));
    } finally {
      nowSpy.mockRestore();
    }

    act(() => result.current.refresh());
    await waitFor(() => expect(scans()).toBe(3));
    expect(result.current.refreshLocalLibrary).toBe(result.current.refresh);
    expect(invokeMock.mock.calls.filter(([command]) => command === "cleanup_export_root")).toHaveLength(1);
  });
});

describe("new chapters", () => {
  it("counts chapters published after a whole-novel download, never for ranges or translations", async () => {
    const { newChaptersFor } = await import("../app/useLocalLibrary");
    const known = novel({ id: "cn:42", title: "Solo", chapters: 120 });
    const whole = entry({ title: "Solo", outputDir: "/o/a", chapterCount: 100 });
    expect(newChaptersFor(whole, known)).toBe(20);
    expect(newChaptersFor({ ...whole, partialRange: true }, known)).toBe(0);
    expect(newChaptersFor({ ...whole, language: "pt-BR" }, known)).toBe(0);
    expect(newChaptersFor({ ...whole, chapterCount: 130 }, known)).toBe(0);
    expect(newChaptersFor(whole, undefined)).toBe(0);
  });
});
