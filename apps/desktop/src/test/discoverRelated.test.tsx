import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Novel } from "../core/types";
import { DiscoverDetailPanel } from "../features/discover/DiscoverDetailPanel";
import { discoverStrings } from "../strings/discover";

const base: Novel = {
  id: "cn:ss", title: "Shadow Slave", author: "Guiltythree", sourceId: "central-novel", sourceName: "Central Novel",
  tags: ["Ação"], tagKeys: ["genre.action"], status: "ongoing", chapters: 2000, language: "pt-BR", updatedAt: "",
  description: "Sunny.", coverClass: ""
};

describe("Discover details: other editions and similar novels", () => {
  it("lists the same work in other sources and similar novels, and opens them", () => {
    const onOpenNovel = vi.fn();
    const edition = { ...base, id: "gn:ss", sourceId: "golden-novel", sourceName: "Golden Novel", language: "en", chapters: 2300 };
    const similar = { ...base, id: "cn:lotm", title: "Lord of the Mysteries", rating: 4.8 };
    render(
      <DiscoverDetailPanel novel={base} isSelected={false} preview selection={null} adding={false} inLibrary={false} queued={false}
        onClose={vi.fn()} onSelect={vi.fn()} onSelectionChange={vi.fn()} onAdd={vi.fn()}
        editions={[edition]} similar={[similar]} onOpenNovel={onOpenNovel} />
    );
    const editions = screen.getByTestId("discover-editions");
    expect(within(editions).getByText(discoverStrings.alsoIn)).toBeInTheDocument();
    expect(editions).toHaveTextContent("Golden Novel");
    expect(editions).toHaveTextContent("EN");
    fireEvent.click(within(editions).getByRole("button"));
    expect(onOpenNovel).toHaveBeenCalledWith(edition);

    const similars = screen.getByTestId("discover-similar");
    fireEvent.click(within(similars).getByRole("button", { name: /Lord of the Mysteries/ }));
    expect(onOpenNovel).toHaveBeenLastCalledWith(similar);
  });

  it("'Sugerir parecidos' asks for curated suggestions with this novel as the reference", () => {
    const onSuggestSimilar = vi.fn();
    render(
      <DiscoverDetailPanel novel={base} isSelected={false} preview selection={null} adding={false} inLibrary={false} queued={false}
        onClose={vi.fn()} onSelect={vi.fn()} onSelectionChange={vi.fn()} onAdd={vi.fn()}
        onSuggestSimilar={onSuggestSimilar} suggestAvailable />
    );
    // The section shows the button even when no novel shares enough tags.
    fireEvent.click(within(screen.getByTestId("discover-similar")).getByRole("button", { name: discoverStrings.suggestSimilar }));
    expect(onSuggestSimilar).toHaveBeenCalledWith(base);
  });

  it("hides the sections when there is nothing to show", () => {
    render(
      <DiscoverDetailPanel novel={base} isSelected={false} preview selection={null} adding={false} inLibrary={false} queued={false}
        onClose={vi.fn()} onSelect={vi.fn()} onSelectionChange={vi.fn()} onAdd={vi.fn()} />
    );
    expect(screen.queryByTestId("discover-editions")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-similar")).not.toBeInTheDocument();
  });
});
