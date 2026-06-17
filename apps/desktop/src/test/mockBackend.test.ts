import { describe, expect, it } from "vitest";
import {
  defaultFilters,
  defaultSelection,
  estimateChapters,
  mockBackend,
  selectionLabel
} from "../services/mockBackend";

describe("mockBackend", () => {
  it("returns bootstrap payload with sources, novels, queue and library", async () => {
    const payload = await mockBackend.bootstrap();

    expect(payload.sources.length).toBeGreaterThan(0);
    expect(payload.novels.length).toBeGreaterThan(0);
    expect(payload.queue.length).toBeGreaterThan(0);
    expect(payload.library.length).toBeGreaterThan(0);
  });

  it("filters novels by query and tag", async () => {
    const filters = defaultFilters();
    const results = await mockBackend.searchNovels({
      ...filters,
      query: "forest",
      tags: ["Fantasia"]
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((novel) => novel.title.toLowerCase().includes("forest") || novel.author.toLowerCase().includes("forest"))).toBe(true);
    expect(results.every((novel) => novel.tags.includes("Fantasia"))).toBe(true);
  });

  it("creates queue items from per-novel chapter selections", async () => {
    const payload = await mockBackend.bootstrap();
    const novel = payload.novels.find((item) => item.id === "forgotten-kingdom");
    expect(novel).toBeDefined();

    const selection = defaultSelection(novel!);
    const [item] = await mockBackend.createDownloads([selection]);

    expect(item.novelId).toBe(novel!.id);
    expect(item.rangeLabel).toBe(selectionLabel(selection, novel!.chapters));
    expect(item.chaptersTotal).toBe(estimateChapters(selection, novel!.chapters));
  });
});

