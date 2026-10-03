import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultFilters } from "../core/defaults";
import type { Novel, SourceSite } from "../core/types";
import { DiscoverView, type DiscoverViewProps } from "../features/discover/DiscoverView";
import type { SmartResult } from "../services/smartFilter";
import { discoverStrings } from "../strings/discover";

const novel = (id: string): Novel => ({
  id, title: id, author: "", sourceId: "central-novel", sourceName: "Central Novel", tags: [], tagKeys: [],
  status: "ongoing", chapters: 300, language: "pt-BR", updatedAt: "", description: "", coverClass: ""
});
const source: SourceSite = {
  id: "central-novel", name: "Central Novel", baseUrl: "", count: 3, status: "online", enabled: true,
  mode: "static_html", lastSync: "", delayMs: 0
};
const results = ["A", "B", "C"].map(novel);

function smart(picks: string[]): SmartResult {
  return {
    intent: {
      summary: "Parecido com Shadow Slave", includeTags: [], excludeTags: [], status: "any", language: "all",
      minChapters: null, maxChapters: null, like: ["Shadow Slave"], query: "", profile: "Órfão num mundo de pesadelos", keywords: [], alsoLike: [], traits: []
    },
    filters: defaultFilters("all"), seeds: [], source: "ai", picks, candidatesRead: 3,
    pickNovels: picks.map((id) => results.find((n) => n.id === id)!),
    scores: { A: 1, B: 0.5, C: 109 }, reasons: { C: "Protagonista amaldiçoado num mundo de pesadelos" }
  };
}

function renderView(patch: Partial<DiscoverViewProps>) {
  const props: DiscoverViewProps = {
    sources: [source], filters: defaultFilters("all"), tagCatalog: [], results, selection: null, loading: false,
    searchError: null, detailFromPreview: false, sortDirection: "asc", adding: false, selectedInLibrary: false,
    selectedQueued: false, onFiltersChange: vi.fn(), onSelectNovel: vi.fn(), onClearSelection: vi.fn(),
    onPreviewNovel: vi.fn(), onClearPreview: vi.fn(), onSelectionChange: vi.fn(), onAddSelected: vi.fn(),
    onRetrySearch: vi.fn(), onOpenSources: vi.fn(), onOpenSettings: vi.fn(), onSuggestSimilar: vi.fn(), onClearSmart: vi.fn(),
    aiAvailable: true, ...patch
  };
  return render(<DiscoverView {...props} />);
}

const titles = () => screen.queryAllByTestId("card-title").map((el) => el.textContent);

describe("Filtro inteligente: curated grid", () => {
  it("shows only the novels the model kept, with its reason, and can show the tag matches too", () => {
    renderView({ smart: smart(["C"]) });
    expect(titles()).toEqual(["C"]);
    expect(screen.getByText("Protagonista amaldiçoado num mundo de pesadelos")).toBeInTheDocument();
    expect(screen.getByTestId("smart-filter-picks")).toHaveTextContent(discoverStrings.smartPicked(1, 3));

    fireEvent.click(screen.getByTestId("smart-filter-broad"));
    expect(titles()).toEqual(["C", "A", "B"]);
    fireEvent.click(screen.getByTestId("smart-filter-broad"));
    expect(titles()).toEqual(["C"]);
  });

  it("says so when nothing came close, and offers the tag matches", () => {
    renderView({ smart: smart([]) });
    expect(titles()).toEqual([]);
    expect(screen.getByText(discoverStrings.smartNoPicksTitle)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: discoverStrings.smartShowBroad }));
    expect(titles()).toHaveLength(3);
  });

  it("shows the picks even when the grid search found none of them", () => {
    renderView({ smart: smart(["C"]), results: [] });
    expect(titles()).toEqual(["C"]);
  });

  it("shows nothing above the grid when no suggestion is active", () => {
    renderView({});
    expect(screen.queryByTestId("smart-filter")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: discoverStrings.smartTitle })).not.toBeInTheDocument();
  });

  it("tells what it is doing while the model reads the synopses", () => {
    renderView({ smartBusy: true, smartStage: { stage: "reading", candidates: 36 } });
    expect(within(screen.getByTestId("smart-filter")).getByRole("status")).toHaveTextContent(discoverStrings.smartReading(36));
  });
});
