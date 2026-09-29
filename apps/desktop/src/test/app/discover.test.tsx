import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultAppConfig } from "../../core/appConfig";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { commonStrings, kindleStrings } from "../../strings/common";
import { discoverStrings } from "../../strings/discover";
import {
  defaultBookTitle,
  findBookCardTitle,
  renderApp,
  renderReadyApp,
  resetAppState,
  seedSetup,
  setupUser
} from "../renderApp";

describe("Discover", () => {
  beforeEach(resetAppState);

  it("loads the discover screen from the mock backend", async () => {
    await renderReadyApp();

    expect(screen.getByText(discoverStrings.results)).toBeInTheDocument();
    expect(await findBookCardTitle(defaultBookTitle)).toBeInTheDocument();
    expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument();
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
    expect(screen.getAllByTestId("book-card")).toHaveLength(60);

    await setupUser().click(screen.getByRole("button", { name: discoverStrings.showMore }));
    expect(screen.getAllByTestId("book-card")).toHaveLength(75);
    expect(screen.getByText(discoverStrings.resultCount(75, 75))).toBeInTheDocument();
  });

  it("uses a single filter toggle and removes the filter panel when hidden", async () => {
    const user = setupUser();
    await renderReadyApp();

    expect(screen.getByRole("heading", { name: commonStrings.filters })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: commonStrings.hideFilters })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: commonStrings.showFilters })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: commonStrings.hideFilters }));

    expect(screen.queryByRole("heading", { name: commonStrings.filters })).not.toBeInTheDocument();
    expect(screen.queryByTestId("filter-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: commonStrings.showFilters })).toBeInTheDocument();
  });

  it("keeps selected novels visible when filters hide all results", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(await screen.findByRole("button", { name: discoverStrings.selectForQueue(defaultBookTitle) }));
    const panel = screen.getByTestId("queue-panel");
    expect(await within(panel).findByText(defaultBookTitle)).toBeInTheDocument();

    await user.type(screen.getByLabelText(commonStrings.search), "resultado que nao existe");

    expect(await screen.findByText(discoverStrings.resultCount(0, 0))).toBeInTheDocument();
    expect(within(panel).getByText(defaultBookTitle)).toBeInTheDocument();
  });
});
