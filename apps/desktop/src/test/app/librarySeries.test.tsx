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

async function openSeries(user: TestUser) {
  await user.click(screen.getByRole("button", { name: seriesLabel }));
  return screen.getByTestId("series-detail");
}

const volumeTitles = (detail: HTMLElement) =>
  within(detail).getAllByTestId("series-volume").map((row) => row.querySelector(".library-volume__title")?.textContent);

describe("Series in the library", () => {
  beforeEach(resetAppState);

  it("shows the volumes as one series card in the grid and as one row that opens in the list", async () => {
    const user = setupUser();
    await openLibrary(user);

    const cards = screen.getAllByTestId("library-card");
    // The two catalog books and one card for the four volumes.
    expect(cards).toHaveLength(3);
    const card = cards.find((element) => element.dataset.series === "series:unsheathed")!;
    expect(within(card).getByRole("button", { name: seriesLabel })).toHaveTextContent("Unsheathed");
    expect(within(card).getByTestId("library-stack-count")).toHaveTextContent(librarySeriesStrings.volumesCount(4));
    expect(card).toHaveClass("is-stack", "is-stack-deep", "is-series");
    // Its menu is about the series, not about volume 1.
    fireEvent.contextMenu(card, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent))
      .toEqual([librarySeriesStrings.openSeries, librarySeriesStrings.sendSeries]);
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

    // From the list row, the series page.
    await user.click(within(row).getByRole("button", { name: librarySeriesStrings.openSeriesOf("Unsheathed") }));
    expect(screen.getByTestId("series-detail")).toBeInTheDocument();
  });

  it("opens the series page with the volumes in order and actions on each volume", async () => {
    const user = setupUser();
    await openLibrary(user);
    const detail = await openSeries(user);

    expect(within(detail).getByRole("heading", { level: 2, name: "Unsheathed" })).toBeInTheDocument();
    expect(within(detail).getByText("Feng Huo Xi Zhu Hou")).toBeInTheDocument();
    expect(volumeTitles(detail)).toEqual(["Caged Sparrow", "Broken Wings", "Fallen Star", "Last Light"]);
    // The volume without files cannot be sent.
    expect(within(detail).getByRole("button", { name: librarySeriesStrings.sendVolume("Fallen Star") })).toBeDisabled();

    await user.click(within(detail).getByRole("button", { name: librarySeriesStrings.removeVolume("Broken Wings") }));
    expect(await screen.findByRole("dialog")).toHaveTextContent(libraryStrings.confirmRemoveTitle("Broken Wings"));
    await user.click(screen.getByRole("button", { name: libraryStrings.cancel }));

    await user.click(within(detail).getByRole("button", { name: librarySeriesStrings.openVolume("Broken Wings") }));
    expect(within(screen.getByTestId("library-detail")).getByRole("heading", { level: 2, name: "Broken Wings" })).toBeInTheDocument();
  });

  it("sends the downloaded volumes, in order, through the Kindle page", async () => {
    const user = setupUser();
    await openLibrary(user);
    const detail = await openSeries(user);

    await user.click(within(detail).getByTestId("series-send-kindle"));
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.kindle })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: kindlePageStrings.queueLabel });
    const queued = within(list).getAllByTestId("library-queue-card").map((card) => card.querySelector("strong")?.textContent);
    expect(queued).toEqual(["Caged Sparrow", "Broken Wings", "Last Light"]);
    expect(screen.getByTestId("kindle-send")).toHaveTextContent(kindlePageStrings.send(3));
  });
});
