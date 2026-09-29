import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { commonStrings, navStrings } from "../../strings/common";
import { downloadsStrings } from "../../strings/downloads";
import { libraryStrings } from "../../strings/library";
import {
  createTestQueue,
  getLibraryCard,
  getToastRegion,
  instantRunner,
  renderReadyApp,
  resetAppState,
  setupUser,
  tabName
} from "../renderApp";

describe("Library", () => {
  beforeEach(resetAppState);

  it("switches the local library queue to Kindle mode when connected", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: navStrings.library }));
    expect(screen.getByRole("heading", { name: commonStrings.filters })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: commonStrings.hideFilters }));
    expect(screen.queryByRole("heading", { name: commonStrings.filters })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: commonStrings.showFilters }));
    expect(screen.getByRole("heading", { name: commonStrings.filters })).toBeInTheDocument();
    expect(screen.queryByText(commonStrings.synopsis)).not.toBeInTheDocument();

    const { card, title } = getLibraryCard("To Kill a Mockingbird");
    expect(within(card).getByTestId("book-cover").style.backgroundImage).toContain("oghma-icon.svg");

    await user.click(title);
    const sidebar = screen.getByTestId("library-sidebar");
    expect(within(sidebar).getByText(commonStrings.synopsis)).toBeInTheDocument();
    expect(within(sidebar).getByTestId("detail-cover").style.backgroundImage).toContain("oghma-icon.svg");
    await user.click(screen.getByRole("tab", { name: tabName(commonStrings.queueTab) }));
    expect(screen.getByRole("heading", { name: libraryStrings.kindleQueueHeading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EPUB" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TXT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AZW3" })).toHaveAttribute("aria-pressed", "true");
    // Translation is not offered when sending to the Kindle.
    expect(screen.queryByRole("button", { name: /Traduzir/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: commonStrings.audiobook })).toBeDisabled();
    expect(screen.getByRole("button", { name: libraryStrings.sendToKindle })).toBeInTheDocument();
  });
});

describe("Library re-download and conversion", () => {
  beforeEach(resetAppState);

  it("re-downloads a library book from the catalog", async () => {
    const user = setupUser();
    const { queue } = await renderReadyApp();

    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await user.click(getLibraryCard("Mystery of the Lost Temple").title);
    const sidebar = screen.getByTestId("library-sidebar");
    await user.click(within(sidebar).getByRole("button", { name: libraryStrings.downloadAgain }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.started)).toBeInTheDocument());
    expect(queue.getSnapshot().active).toMatchObject({ novelId: "lost-temple", kind: "download" });
    await waitFor(() => expect(within(sidebar).getByRole("button", { name: libraryStrings.downloadAgain })).toBeDisabled());
  });

  it("disables re-download when the book has no catalog match", async () => {
    const user = setupUser();
    const backend: BackendClient = {
      ...mockBackendClient,
      async bootstrap() {
        const payload = await mockBackendClient.bootstrap();
        return { ...payload, library: payload.library.map((item) => ({ ...item, novelId: undefined })) };
      }
    };
    await renderReadyApp(backend);

    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await user.click(getLibraryCard("Mystery of the Lost Temple").title);
    const button = within(screen.getByTestId("library-sidebar")).getByRole("button", { name: libraryStrings.downloadAgain });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", libraryStrings.notInCatalog);
  });

  it("runs Kindle conversions as convert jobs in the download queue", async () => {
    const user = setupUser();
    const queue = createTestQueue({ runJob: instantRunner });
    await renderReadyApp(undefined, queue);

    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await user.click(getLibraryCard("Mystery of the Lost Temple").title);
    await user.click(screen.getByRole("tab", { name: tabName(commonStrings.queueTab) }));
    await user.click(screen.getByRole("button", { name: libraryStrings.sendToKindle }));

    await waitFor(() => expect(queue.getSnapshot().completed).toHaveLength(1));
    expect(queue.getSnapshot().completed[0]).toMatchObject({ kind: "convert", novelId: "lost-temple", status: "done" });
    expect(queue.getSnapshot().completed[0].request.formats).toEqual(["AZW3"]);
    // Outside Tauri the device transfer itself is unavailable.
    await waitFor(() => expect(within(getToastRegion()).getByText(/Envio direto ao Kindle/)).toBeInTheDocument());
  });
});
