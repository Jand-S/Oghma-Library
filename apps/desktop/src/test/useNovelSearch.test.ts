import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useNovelSearch } from "../app/useNovelSearch";
import { defaultFilters } from "../core/defaults";
import type { Novel } from "../core/types";
import type { BackendClient } from "../services/backendClient";

describe("useNovelSearch", () => {
  it("busca já na primeira renderização: a fonte inicial pode não ser a que o bootstrap trouxe", async () => {
    const lunar = { id: "novellunar:unsheathed", title: "Unsheathed", sourceId: "novellunar" } as Novel;
    const backend = { searchNovels: vi.fn(async () => [lunar]) } as unknown as BackendClient;
    const setResults = vi.fn();
    const setFocusedNovelId = vi.fn();
    const filters = defaultFilters("novellunar");
    const setToast = vi.fn();
    renderHook(() => useNovelSearch({
      backend,
      filters,
      focusedNovelId: "",
      loading: false,
      setFocusedNovelId,
      setResults,
      setToast
    }));
    await waitFor(() => expect(setResults).toHaveBeenCalledWith([lunar]));
    expect(backend.searchNovels).toHaveBeenCalledTimes(1);
    expect(setFocusedNovelId).toHaveBeenCalledWith("novellunar:unsheathed");
  });
});
