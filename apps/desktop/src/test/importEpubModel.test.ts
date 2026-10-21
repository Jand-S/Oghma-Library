import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Novel } from "../core/types";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));

const listenMock = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({ listen: (...args: unknown[]) => listenMock(...args) }));

import { buildCatalogIndex } from "../services/catalogIndex";
import { importApi, importKey, isImportKey, type ImportPreview } from "../services/importClient";
import { drawImportCover } from "../features/library/importCover";
import { catalogAuthorForSeries, commitItemOf, commitOutcome, coverTextOf, draftFromPreview, isImportable, parseVolume, volumeBlocks } from "../features/library/importModel";
import { useSettledValue } from "../features/library/useSettledValue";

function setTauri(enabled: boolean) {
  const target = window as unknown as Record<string, unknown>;
  if (enabled) target.__TAURI_INTERNALS__ = {};
  else delete target.__TAURI_INTERNALS__;
}

function novel(title: string, author: string): Novel {
  return {
    id: `cn:${title}`,
    title,
    author,
    sourceId: "cn",
    sourceName: "Central Novel",
    tags: [],
    tagKeys: [],
    status: "ongoing" as Novel["status"],
    chapters: 10,
    language: "en",
    updatedAt: "",
    description: "",
    coverClass: "cover-a"
  };
}

function preview(partial: Partial<ImportPreview> & Pick<ImportPreview, "id">): ImportPreview {
  return {
    fileName: `${partial.id}.epub`,
    sha256: "a".repeat(64),
    size: 1024,
    title: "Caged Sparrow",
    author: null,
    language: null,
    series: { id: "series:unsheathed", name: "Unsheathed", volume: 1 },
    seriesSource: "filename",
    coverDataUrl: null,
    coverFromLibrary: null,
    alreadyImported: null,
    error: null,
    ...partial
  };
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
});

afterEach(() => {
  setTauri(false);
  vi.restoreAllMocks();
});

describe("importApi", () => {
  it("calls the contract's commands with their exact names and arguments", async () => {
    setTauri(true);
    invokeMock.mockResolvedValue([]);
    await importApi.pick();
    await importApi.preview(["f1", "f2"]);
    const item = { id: "f1", title: "Caged Sparrow", author: "", series: { name: "Unsheathed", volume: 1 }, coverPng: [137, 80] };
    await importApi.commit([item]);
    await importApi.upload("import:abc");
    await importApi.download("import:abc", "Caged Sparrow");
    await importApi.usage();
    expect(invokeMock.mock.calls).toEqual([
      ["import_epub_pick", undefined],
      ["import_epub_preview", { ids: ["f1", "f2"] }],
      ["import_epub_commit", { items: [item] }],
      ["account_file_upload", { key: "import:abc" }],
      ["account_file_download", { key: "import:abc", title: "Caged Sparrow" }],
      ["account_files_usage", undefined]
    ]);
  });

  it("listens to dropped files and upload progress, and does nothing outside the app", async () => {
    expect(importApi.available).toBe(false);
    await expect(importApi.pick()).rejects.toThrow("unavailable");
    const handler = vi.fn();
    (await importApi.onDropped(handler))();
    expect(listenMock).not.toHaveBeenCalled();

    setTauri(true);
    expect(importApi.available).toBe(true);
    const stop = vi.fn();
    listenMock.mockResolvedValue(stop);
    expect(await importApi.onDropped(handler)).toBe(stop);
    expect(listenMock).toHaveBeenCalledWith("import-epub-dropped", expect.any(Function));
    const files = [{ id: "f1", fileName: "a.epub", size: 3 }];
    listenMock.mock.calls[0][1]({ payload: files });
    expect(handler).toHaveBeenCalledWith(files);

    await importApi.onFileProgress(handler);
    expect(listenMock).toHaveBeenLastCalledWith("account-file-progress", expect.any(Function));
  });

  it("builds and recognizes import keys", () => {
    expect(importKey("ab12")).toBe("import:ab12");
    expect(isImportKey("import:ab12")).toBe(true);
    expect(isImportKey("cn:42")).toBe(false);
    expect(isImportKey(undefined)).toBe(false);
  });
});

describe("import drafts", () => {
  const index = buildCatalogIndex([novel("Unsheathed (Novel)", "Feng Huo Xi Zhu Hou"), novel("Outra", "Fulano")]);

  it("suggests the author of a catalog novel named like the series when the EPUB has none", () => {
    expect(catalogAuthorForSeries(index, "unsheathed")).toBe("Feng Huo Xi Zhu Hou");
    expect(catalogAuthorForSeries(index, "Unsheathed 2")).toBe("");
    expect(catalogAuthorForSeries(null, "Unsheathed")).toBe("");

    const suggested = draftFromPreview(preview({ id: "a" }), index);
    expect(suggested).toMatchObject({ title: "Caged Sparrow", author: "Feng Huo Xi Zhu Hou", authorFromCatalog: true, seriesName: "Unsheathed", volume: "1" });

    const own = draftFromPreview(preview({ id: "b", author: "Autora do EPUB" }), index);
    expect(own).toMatchObject({ author: "Autora do EPUB", authorFromCatalog: false });

    const noSeries = draftFromPreview(preview({ id: "c", series: null, seriesSource: null, title: "Unsheathed" }), index);
    expect(noSeries).toMatchObject({ author: "", authorFromCatalog: false, seriesName: "", volume: "" });
  });

  it("parses the volume with at most one decimal", () => {
    expect(parseVolume("")).toBeNull();
    expect(parseVolume(" 3 ")).toBe(3);
    expect(parseVolume("2,5")).toBe(2.5);
    expect(parseVolume("2.5")).toBe(2.5);
    expect(parseVolume("2,55")).toBeUndefined();
    expect(parseVolume("um")).toBeUndefined();
    expect(draftFromPreview(preview({ id: "a", series: { id: "series:x", name: "X", volume: 2.5 } }), null).volume).toBe("2,5");
  });

  it("leaves invalid, already imported and bad-volume files out of the commit", () => {
    expect(isImportable(draftFromPreview(preview({ id: "a" }), null))).toBe(true);
    expect(isImportable(draftFromPreview(preview({ id: "b", error: "invalid_epub" }), null))).toBe(false);
    expect(isImportable(draftFromPreview(preview({ id: "c", alreadyImported: { outputDir: "/out/x" } }), null))).toBe(false);
    expect(isImportable({ ...draftFromPreview(preview({ id: "d" }), null), volume: "x" })).toBe(false);
  });

  it("ignores the volume once the series is cleared", () => {
    const draft = { ...draftFromPreview(preview({ id: "a" }), null), volume: "x" };
    expect(volumeBlocks(draft)).toBe(true);
    const noSeries = { ...draft, seriesName: "  " };
    expect(volumeBlocks(noSeries)).toBe(false);
    expect(isImportable(noSeries)).toBe(true);
    expect(commitItemOf(noSeries, null).series).toBeNull();
  });

  it("judges the commit per submitted file: missing or keyless answers failed, strays are ignored", () => {
    const ok = (id: string) => ({ id, key: `import:${id}`, outputDir: `/out/${id}`, error: null });
    const outcome = commitOutcome(["a", "b", "c", "d"], [
      ok("a"),
      { id: "b", key: "", outputDir: null, error: "disk_full" },
      { id: "c", key: "", outputDir: null, error: null },
      ok("stray")
    ], "sem resposta");
    expect(outcome.keys).toEqual(["import:a"]);
    expect([...outcome.failed]).toEqual([["b", "disk_full"], ["c", "sem resposta"], ["d", "sem resposta"]]);
    expect(commitOutcome(["a"], [ok("a")], "x")).toEqual({ keys: ["import:a"], failed: new Map() });
  });

  it("turns an edited draft into the commit item", () => {
    const draft = { ...draftFromPreview(preview({ id: "a" }), null), title: "  Pardal ", author: " Eu ", seriesName: " Unsheathed ", volume: "2,5" };
    expect(commitItemOf(draft, new Uint8Array([137, 80]))).toEqual({
      id: "a",
      title: "Pardal",
      author: "Eu",
      series: { name: "Unsheathed", volume: 2.5 },
      coverPng: [137, 80]
    });
    expect(commitItemOf({ ...draft, seriesName: "" }, null)).toMatchObject({ series: null, coverPng: null });
    expect(coverTextOf(draft)).toEqual({ series: "Unsheathed", volume: 2.5, subtitle: "Pardal" });
    expect(coverTextOf({ ...draft, seriesName: "" })).toEqual({ series: "Pardal", volume: null, subtitle: "" });
  });
});

describe("useSettledValue (generated cover redraw)", () => {
  afterEach(() => vi.useRealTimers());

  it("gives the first value at once and later ones only after the typing stops", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ text }) => useSettledValue({ text }, text, 250), { initialProps: { text: "P" } });
    expect(result.current).toEqual({ text: "P" });
    rerender({ text: "Pa" });
    act(() => void vi.advanceTimersByTime(200));
    rerender({ text: "Par" });
    act(() => void vi.advanceTimersByTime(200));
    expect(result.current).toEqual({ text: "P" });
    act(() => void vi.advanceTimersByTime(50));
    expect(result.current).toEqual({ text: "Par" });
  });
});

describe("drawImportCover", () => {
  it("draws series, volume and subtitle and returns the PNG bytes", () => {
    const texts: string[] = [];
    const ctx = {
      fillRect: vi.fn(),
      fillText: (text: string) => texts.push(text),
      measureText: (text: string) => ({ width: text.length * 20 })
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    const png = "\x89PNG\r\n\x1a\n";
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${btoa(png)}`);

    const cover = drawImportCover({ series: "Unsheathed", volume: 1, subtitle: "Caged Sparrow" });
    expect(texts).toEqual(["Volume 1", "Unsheathed", "Caged Sparrow"]);
    expect(cover?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(Array.from(cover!.bytes)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("returns null where there is no 2D canvas", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(drawImportCover({ series: "X", volume: null, subtitle: "" })).toBeNull();
  });
});
