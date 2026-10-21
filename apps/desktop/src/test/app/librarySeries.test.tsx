import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { BookSeries, LibraryItem } from "../../core/types";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { navStrings, pageTitleStrings } from "../../strings/common";
import { kindlePageStrings } from "../../strings/kindle";
import { libraryStrings } from "../../strings/library";
import { librarySeriesStrings } from "../../strings/librarySeries";
import { renderReadyApp, resetAppState, setupUser, type TestUser } from "../renderApp";

const series = (volume: number): BookSeries => ({ id: "series:unsheathed", name: "Unsheathed", volume });

function volume(id: string, title: string, number: number, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id,
    novelId: `import:${id.padEnd(64, "0")}`,
    title,
    author: "Feng Huo Xi Zhu Hou",
    format: "EPUB",
    formats: ["EPUB"],
    chapters: 0,
    sizeMb: 2,
    coverClass: "cover-c",
    outputDir: `~/Documents/Oghma Library/exports/Unsheathed - Vol ${number} - ${title}`,
    files: [`${title}.epub`],
    exportedAt: "Hoje, 10:00",
    private: true,
    series: series(number),
    ...overrides
  };
}

// Out of order on purpose; volume 3 has no files on this computer.
const volumes = [
  volume("v2", "Broken Wings", 2),
  volume("v10", "Last Light", 10),
  volume("v1", "Caged Sparrow", 1),
  volume("v3", "Fallen Star", 3, { availability: "shelf", files: [], formats: [], outputDir: undefined })
];

const backend: BackendClient = {
  ...mockBackendClient,
  async bootstrap() {
    const payload = await mockBackendClient.bootstrap();
    return { ...payload, library: [...payload.library, ...volumes] };
  }
};

const seriesLabel = librarySeriesStrings.seriesOf("Unsheathed", 4);

async function openLibrary(user: TestUser) {
  await renderReadyApp(backend);
  await user.click(screen.getByRole("button", { name: navStrings.library }));
  await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
}

/** Clicking the series card spreads its volumes, like the editions of a work (no separate page). */
async function openSeries(user: TestUser) {
  await user.click(screen.getByRole("button", { name: seriesLabel }));
  return screen.getByTestId("series-spread");
}

const volumeLabels = (spread: HTMLElement) =>
  within(spread).getAllByTestId("stack-spread-item").map((item) => item.querySelector(".o-stack-spread__label")?.textContent);

const seriesCard = () => screen.getAllByTestId("library-card").find((element) => element.dataset.series === "series:unsheathed")!;

describe("Series in the library", () => {
  beforeEach(resetAppState);

  it("shows the volumes as one series card in the grid and as one row that opens in the list", async () => {
    const user = setupUser();
    await openLibrary(user);

    const cards = screen.getAllByTestId("library-card");
    // The two catalog books and one card for the four volumes.
    expect(cards).toHaveLength(3);
    const card = seriesCard();
    expect(within(card).getByRole("button", { name: seriesLabel })).toHaveTextContent("Unsheathed");
    expect(within(card).getByRole("button", { name: seriesLabel })).toHaveAttribute("aria-haspopup", "dialog");
    // "4 volumes" with its own icon (books side by side), not the editions' stack.
    const badge = within(card).getByTestId("library-stack-count");
    expect(badge).toHaveTextContent(librarySeriesStrings.volumesCount(4));
    expect(badge).toHaveAttribute("data-kind", "series");
    expect(card).toHaveClass("is-stack", "is-stack-deep", "is-series");
    // Its menu is about the series, not about volume 1.
    fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent))
      .toEqual([librarySeriesStrings.showVolumes, librarySeriesStrings.sendSeries]);
    await user.keyboard("{Escape}");

    await user.click(screen.getByRole("radio", { name: libraryStrings.viewList }));
    const row = screen.getAllByTestId("library-row").find((element) => element.dataset.editions === "4")!;
    expect(within(row).getByRole("button", { name: seriesLabel })).toHaveAttribute("aria-expanded", "false");
    await user.click(within(row).getByRole("button", { name: seriesLabel }));
    const rows = screen.getAllByTestId("library-row");
    expect(rows).toHaveLength(3 + 4);
    const opened = rows.slice(rows.indexOf(row) + 1, rows.indexOf(row) + 5);
    expect(opened.map((element) => within(element).getByTestId("card-title").textContent))
      .toEqual(["Caged Sparrow", "Broken Wings", "Fallen Star", "Last Light"]);
    expect(within(opened[0]).getByText(librarySeriesStrings.volumeShort(1))).toBeInTheDocument();
    // No separate series page anywhere.
    expect(screen.queryByTestId("series-detail")).not.toBeInTheDocument();
  });

  it("spreads the volumes in order like the editions, and a volume opens the book details", async () => {
    const user = setupUser();
    await openLibrary(user);
    const spread = await openSeries(user);

    expect(spread).toHaveAttribute("role", "dialog");
    expect(spread).toHaveAccessibleName(`Unsheathed: ${librarySeriesStrings.volumesCount(4)}`);
    expect(within(spread).getByTestId("stack-spread-count")).toHaveTextContent(librarySeriesStrings.volumesCount(4));
    expect(volumeLabels(spread)).toEqual([
      librarySeriesStrings.volumeTitle(1, "Caged Sparrow"),
      librarySeriesStrings.volumeTitle(2, "Broken Wings"),
      librarySeriesStrings.volumeTitle(3, "Fallen Star"),
      librarySeriesStrings.volumeTitle(10, "Last Light")
    ]);
    expect(volumeLabels(spread)[0]).toBe("Vol. 1 · Caged Sparrow");
    // The volume without files here carries the same "Na estante" chip as an edition.
    const items = within(spread).getAllByTestId("stack-spread-item");
    expect(within(items[2]).getByText(libraryStrings.onShelfBadge)).toBeInTheDocument();
    expect(within(items[1]).queryByText(libraryStrings.onShelfBadge)).not.toBeInTheDocument();

    await user.click(items[1]);
    expect(screen.queryByTestId("series-spread")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("library-detail")).getByRole("heading", { level: 2, name: "Broken Wings" })).toBeInTheDocument();
  });

  it("sends the downloaded volumes, in order, from the spread heading", async () => {
    const user = setupUser();
    await openLibrary(user);
    const spread = await openSeries(user);

    const send = within(spread).getByTestId("series-send-kindle");
    expect(send).toHaveTextContent(librarySeriesStrings.sendSeries);
    expect(send).toHaveAttribute("title", librarySeriesStrings.sendSeriesHint(3));
    await user.click(send);
    expect(screen.queryByTestId("series-spread")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.kindle })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: kindlePageStrings.queueLabel });
    const queued = within(list).getAllByTestId("library-queue-card").map((card) => card.querySelector("strong")?.textContent);
    expect(queued).toEqual(["Caged Sparrow", "Broken Wings", "Last Light"]);
    expect(screen.getByTestId("kindle-send")).toHaveTextContent(kindlePageStrings.send(3));
  });

  it("sends the series and spreads its volumes from the card's ⋯ menu", async () => {
    const user = setupUser();
    await openLibrary(user);

    await user.click(within(seriesCard()).getByRole("button", { name: librarySeriesStrings.seriesActions("Unsheathed") }));
    await user.click(screen.getByRole("menuitem", { name: librarySeriesStrings.showVolumes }));
    expect(volumeLabels(screen.getByTestId("series-spread"))).toHaveLength(4);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByTestId("series-spread")).not.toBeInTheDocument());

    await user.click(within(seriesCard()).getByRole("button", { name: librarySeriesStrings.seriesActions("Unsheathed") }));
    await user.click(screen.getByRole("menuitem", { name: librarySeriesStrings.sendSeries }));
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.kindle })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: kindlePageStrings.queueLabel });
    expect(within(list).getAllByTestId("library-queue-card")).toHaveLength(3);
  });
});
