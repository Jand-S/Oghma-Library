import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../core/appConfig";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { kindleStrings } from "../../strings/common";
import { discoverStrings } from "../../strings/discover";
import {
  defaultBookTitle,
  findBookCardTitle,
  getDetailPanel,
  renderApp,
  renderReadyApp,
  resetAppState,
  seedSetup,
  setupUser
} from "../renderApp";

const filtersToggle = () => screen.getByRole("button", { name: new RegExp(`^${discoverStrings.filtersToggle}`) });

describe("Discover", () => {
  beforeEach(resetAppState);

  it("loads the discover screen from the mock backend", async () => {
    await renderReadyApp();

    expect(screen.getByRole("heading", { name: discoverStrings.results })).toBeInTheDocument();
    expect(await findBookCardTitle(defaultBookTitle)).toBeInTheDocument();
    expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("discover-detail-panel")).not.toBeInTheDocument();
    expect(screen.getByText(kindleStrings.connected)).toBeInTheDocument();
    const source = screen.getByLabelText(discoverStrings.source) as HTMLSelectElement;
    expect(source.required).toBe(true);
    // A source is mandatory: there is no "all sites" option.
    expect(Array.from(source.options).map((option) => option.value)).not.toContain("all");
  });

  it("renders large sources in batches of 60 cards", async () => {
    let manyNovels: Awaited<ReturnType<BackendClient["searchNovels"]>> = [];
    const manyBackend: BackendClient = {
      ...mockBackendClient,
      async bootstrap() {
        const payload = await mockBackendClient.bootstrap();
        const sample = payload.novels.find((novel) => novel.sourceId === "central-novel")!;
        manyNovels = Array.from({ length: 75 }, (_, index) => ({
          ...sample,
          id: `large-${index + 1}`,
          title: `Large Novel ${index + 1}`
        }));
        return {
          ...payload,
          novels: manyNovels
        };
      },
      async searchNovels() {
        return manyNovels;
      }
    };
    seedSetup(defaultAppConfig(["central-novel"]));
    renderApp(manyBackend);

    expect(await screen.findByText(discoverStrings.resultCount(60, 75), {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(discoverStrings.resultsTotal(75))).toBeInTheDocument();
    expect(screen.getAllByTestId("book-card")).toHaveLength(60);

    await setupUser().click(screen.getByRole("button", { name: discoverStrings.showMore }));
    expect(screen.getAllByTestId("book-card")).toHaveLength(75);
    // Everything is visible: no more batches to load.
    expect(screen.queryByRole("button", { name: discoverStrings.showMore })).not.toBeInTheDocument();
  });

  it("toggles the filter drawer from a single 'Filtros' button", async () => {
    const user = setupUser();
    await renderReadyApp();

    // The drawer starts closed so the grid gets the room.
    expect(screen.queryByTestId("filter-panel")).not.toBeInTheDocument();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "false");

    await user.click(filtersToggle());
    expect(screen.getByRole("heading", { name: discoverStrings.filtersHeading })).toBeInTheDocument();
    expect(screen.getByTestId("filter-panel")).toBeInTheDocument();
    expect(filtersToggle()).toHaveAttribute("aria-expanded", "true");

    await user.click(filtersToggle());
    expect(screen.queryByRole("heading", { name: discoverStrings.filtersHeading })).not.toBeInTheDocument();
    expect(screen.queryByTestId("filter-panel")).not.toBeInTheDocument();
  });

  it("remembers whether the filter drawer was open", async () => {
    const user = setupUser();
    const { unmount } = await renderReadyApp();
    await user.click(filtersToggle());
    unmount();

    renderApp();
    await findBookCardTitle(defaultBookTitle);
    expect(screen.getByTestId("filter-panel")).toBeInTheDocument();
  });

  it("filters by status and shows removable active-filter chips", async () => {
    const user = setupUser();
    await renderReadyApp();
    expect(screen.queryByTestId("active-filter-row")).not.toBeInTheDocument();

    await user.click(filtersToggle());
    await user.selectOptions(screen.getByLabelText(discoverStrings.status), "complete");

    const row = await screen.findByTestId("active-filter-row");
    expect(within(row).getByText("Completa")).toBeInTheDocument();
    // The toggle counts the drawer filters in use.
    expect(filtersToggle()).toHaveTextContent("1");

    await user.click(within(row).getByRole("button", { name: discoverStrings.removeFilter("Completa") }));
    await waitFor(() => expect(screen.queryByTestId("active-filter-row")).not.toBeInTheDocument());
  });

  it("cycles tag chips through include, exclude and neutral", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(filtersToggle());

    const tags = within(screen.getByTestId("filter-panel")).getByRole("group", { name: discoverStrings.tags });
    const tag = await within(tags).findByRole("button", { name: /^Fantasia(,|$)/ });
    expect(tag).toHaveAttribute("aria-pressed", "false");

    await user.click(tag);
    expect(within(tags).getByRole("button", { name: /^Fantasia, exigida$/ })).toHaveAttribute("aria-pressed", "true");
    expect(within(screen.getByTestId("active-filter-row")).getByText("Fantasia")).toBeInTheDocument();

    await user.click(within(tags).getByRole("button", { name: /^Fantasia(,|$)/ }));
    expect(within(tags).getByRole("button", { name: /^Fantasia, excluída$/ })).toBeInTheDocument();

    await user.click(within(tags).getByRole("button", { name: /^Fantasia(,|$)/ }));
    expect(within(tags).getByRole("button", { name: /^Fantasia(,|$)/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("active-filter-row")).not.toBeInTheDocument();
  });

  it("debounces the search and offers to clear filters when nothing matches", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.type(screen.getByLabelText(discoverStrings.search), "resultado que nao existe");

    expect(await screen.findByRole("heading", { name: discoverStrings.noResultsTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: discoverStrings.clearFilters }));

    expect(await findBookCardTitle(defaultBookTitle)).toBeInTheDocument();
    expect(screen.getByLabelText(discoverStrings.search)).toHaveValue("");
  });

  it("keeps the selected novel visible when filters hide all results", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(await screen.findByRole("button", { name: discoverStrings.selectForQueue(defaultBookTitle) }));
    const panel = screen.getByTestId("queue-panel");
    expect(await within(panel).findByText(defaultBookTitle)).toBeInTheDocument();

    await user.type(screen.getByLabelText(discoverStrings.search), "resultado que nao existe");

    expect(await screen.findByRole("heading", { name: discoverStrings.noResultsTitle })).toBeInTheDocument();
    expect(within(screen.getByTestId("queue-panel")).getByText(defaultBookTitle)).toBeInTheDocument();
  });

  it("shows an offline state with a retry when the search fails", async () => {
    let fail = false;
    const flakyBackend: BackendClient = {
      ...mockBackendClient,
      async searchNovels(filters) {
        if (fail) throw new Error("offline");
        return mockBackendClient.searchNovels(filters);
      }
    };
    const user = setupUser();
    await renderReadyApp(flakyBackend);

    fail = true;
    await user.type(screen.getByLabelText(discoverStrings.search), "Enchanted");
    expect(await screen.findByRole("heading", { name: discoverStrings.offlineTitle })).toBeInTheDocument();

    fail = false;
    await user.click(screen.getByRole("button", { name: discoverStrings.retry }));
    expect(await findBookCardTitle(defaultBookTitle)).toBeInTheDocument();
  });

  it("moves focus across the grid with the arrow keys and selects with Enter", async () => {
    const user = setupUser();
    await renderReadyApp();

    const hits = screen.getAllByRole("button", { name: /^Selecionar .* para download$/ });
    // Roving tabindex: only one card is in the tab order.
    expect(hits.filter((hit) => hit.tabIndex === 0)).toHaveLength(1);

    hits[0].focus();
    fireEvent.keyDown(hits[0], { key: "ArrowRight" });
    expect(hits[1]).toHaveFocus();
    fireEvent.keyDown(hits[1], { key: "ArrowLeft" });
    expect(hits[0]).toHaveFocus();

    await user.keyboard("{Enter}");
    await waitFor(() => expect(getDetailPanel()).toBeInTheDocument());
    expect(screen.getByTestId("queue-panel")).toBeInTheDocument();
  });
});
