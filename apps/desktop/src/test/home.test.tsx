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

const story = "Uma história longa o bastante para o destaque: um protagonista, um mundo cruel e um mistério que atravessa volumes.";
const catalog = [
  novel("Shadow Slave", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], lastChapterAt: "2026-10-03T00:00:00Z" }),
  novel("Solo Leveling", { tagKeys: ["genre.action", "genre.fantasy", "theme.level_system"], firstSeenAt: "2026-10-01T00:00:00Z" }),
  novel("Amor de Verão", { tagKeys: ["genre.romance"], sourceId: "off-source" }),
  novel("Lord of the Mysteries", { tagKeys: ["genre.mystery"], rating: 4.9, ratingVotes: 50, coverUrl: "lotm.jpg", description: story }),
  novel("Reverend Insanity", { tagKeys: ["genre.mystery"], rating: 4.7, ratingVotes: 20, coverUrl: "ri.jpg", description: story })
];
const handlers = () => ({ onOpenNovel: vi.fn(), onOpenBook: vi.fn(), onSeeAll: vi.fn(), onBrowseTag: vi.fn(), onOpenLibrary: vi.fn() });
const index = buildCatalogIndex(catalog);

describe("Início", () => {
  it("shows reading, new chapters and suggestions; opens books and novels", () => {
    const props = handlers();
    const { onOpenBook, onOpenNovel } = props;
    const library = [
      book("lib-ss", { title: "Shadow Slave", novelId: "Shadow Slave", readingStatus: "reading", favorite: true, newChapters: 12 })
    ];
    render(<HomeView catalogIndex={index} library={library} sourceIds={["central-novel"]} loading={false} {...props} />);

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

    const fresh2 = screen.getByTestId("home-shelf-updated");
    expect(fresh2).toHaveTextContent("Shadow Slave");
    fireEvent.click(within(fresh2).getByRole("button", { name: /Ver tudo/ }));
    expect(props.onSeeAll).toHaveBeenCalledWith({ sort: "updated" });
    expect(screen.getByTestId("home-shelf-new")).toHaveTextContent("Solo Leveling");
    expect(screen.queryByTestId("home-welcome")).not.toBeInTheDocument();
  });

  it("features well-described novels and opens them; genres open Buscar filtered", () => {
    const props = handlers();
    render(<HomeView catalogIndex={index} library={[]} sourceIds={["central-novel"]} loading={false} {...props} />);

    const hero = screen.getByTestId("home-featured");
    expect(hero).toHaveTextContent("Lord of the Mysteries");
    expect(hero).toHaveTextContent(homeStrings.featured);
    fireEvent.click(within(hero).getByTestId("home-featured-open"));
    expect(props.onOpenNovel).toHaveBeenCalledWith(catalog[3]);
    fireEvent.click(within(hero).getByRole("button", { name: homeStrings.next }));
    expect(hero).toHaveTextContent("Reverend Insanity");

    // A horizontal trackpad swipe turns the page too (one page per gesture).
    fireEvent.wheel(hero, { deltaX: -80, deltaY: 2 });
    expect(hero).toHaveTextContent("Lord of the Mysteries");
    fireEvent.wheel(hero, { deltaX: -80, deltaY: 0 });
    expect(hero).toHaveTextContent("Lord of the Mysteries");
    // Vertical scrolling is left to the page.
    fireEvent.wheel(hero, { deltaX: 0, deltaY: 300 });
    expect(hero).toHaveTextContent("Lord of the Mysteries");
    // Keyboard arrows.
    fireEvent.keyDown(within(hero).getByTestId("home-featured-open"), { key: "ArrowRight" });
    expect(hero).toHaveTextContent("Reverend Insanity");

    const genres = screen.getByTestId("home-genres");
    fireEvent.click(within(genres).getByRole("button", { name: /Mistério/ }));
    expect(props.onBrowseTag).toHaveBeenCalledWith("genre.mystery");
  });

  it("gives a new user a short tip instead of the reader rows", () => {
    render(<HomeView catalogIndex={index} library={[]} sourceIds={["central-novel"]} loading={false} {...handlers()} />);
    expect(screen.getByTestId("home-welcome")).toHaveTextContent(homeStrings.welcomeTip);
    expect(screen.queryByTestId("home-shelf-reading")).not.toBeInTheDocument();
  });
});
