import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LibraryItem, Novel } from "../core/types";
import { HomeView } from "../features/home/HomeView";
import { buildCatalogIndex } from "../services/catalogIndex";
import { homeStrings } from "../strings/home";

function novel(id: string, patch: Partial<Novel> = {}): Novel {
  return {
    id, title: id, author: "", sourceId: "central-novel", sourceName: "Central Novel", tags: [], tagKeys: [],
    status: "ongoing", chapters: 100, language: "pt-BR", updatedAt: "", description: "", coverClass: "", ...patch
  };
}
const book = (id: string, patch: Partial<LibraryItem>): LibraryItem => ({
  id, title: id, author: "", format: "EPUB", chapters: 100, sizeMb: 1, coverClass: "", exportedAt: "", ...patch
});

const catalog = [
  novel("Shadow Slave", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], lastChapterAt: "2026-10-03T00:00:00Z" }),
  novel("Solo Leveling", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], firstSeenAt: "2026-10-01T00:00:00Z" }),
  novel("Amor de Verão", { tagKeys: ["genre.romance"], sourceId: "off-source" })
];
const index = buildCatalogIndex(catalog);

describe("Início", () => {
  it("shows reading, new chapters and suggestions; opens books and novels", () => {
    const onOpenBook = vi.fn();
    const onOpenNovel = vi.fn();
    const library = [
      book("lib-ss", { title: "Shadow Slave", novelId: "Shadow Slave", readingStatus: "reading", favorite: true, newChapters: 12 })
    ];
    render(<HomeView catalogIndex={index} library={library} sourceIds={["central-novel"]} loading={false}
      onOpenNovel={onOpenNovel} onOpenBook={onOpenBook} onExplore={vi.fn()} />);

    expect(screen.getByTestId("home-shelf-reading")).toHaveTextContent(homeStrings.reading);
    const fresh = screen.getByTestId("home-shelf-new-chapters");
    expect(fresh).toHaveTextContent(homeStrings.plusChapters(12));
    fireEvent.click(within(fresh).getByRole("button", { name: /Shadow Slave/ }));
    expect(onOpenBook).toHaveBeenCalledWith(library[0]);

    // Suggested from the favorite, never something already in the library or from a disabled source.
    const forYou = screen.getByTestId("home-shelf-for-you");
    expect(within(forYou).getAllByRole("button").map((b) => b.title)).toEqual(["Solo Leveling"]);
    fireEvent.click(within(forYou).getByRole("button", { name: /Solo Leveling/ }));
    expect(onOpenNovel).toHaveBeenCalledWith(catalog[1]);

    expect(screen.getByTestId("home-shelf-updated")).toHaveTextContent("Shadow Slave");
    expect(screen.getByTestId("home-shelf-new")).toHaveTextContent("Solo Leveling");
    expect(screen.queryByTestId("home-welcome")).not.toBeInTheDocument();
  });

  it("invites a new user to explore the catalog", () => {
    const onExplore = vi.fn();
    render(<HomeView catalogIndex={index} library={[]} sourceIds={["central-novel"]} loading={false}
      onOpenNovel={vi.fn()} onOpenBook={vi.fn()} onExplore={onExplore} />);
    fireEvent.click(within(screen.getByTestId("home-welcome")).getByRole("button", { name: homeStrings.explore }));
    expect(onExplore).toHaveBeenCalled();
    expect(screen.queryByTestId("home-shelf-reading")).not.toBeInTheDocument();
  });
});
