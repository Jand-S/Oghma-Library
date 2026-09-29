import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { commonStrings } from "../../strings/common";
import { discoverStrings } from "../../strings/discover";
import {
  findBookCardTitle,
  getActiveFilterRow,
  getContentArea,
  getDetailPanel,
  getFilterPanel,
  getFirstFilterField,
  getQueuePanel,
  getToolbar,
  inspectBook,
  renderReadyApp,
  resetAppState,
  setupUser,
  tabName
} from "../renderApp";

const queueTab = tabName(commonStrings.queueTab);
const detailsTab = tabName(commonStrings.detailsTab);

async function openPreview(title = "The Enchanted Forest") {
  fireEvent.contextMenu(await findBookCardTitle(title));
}

async function expectPreviewClosed() {
  await waitFor(() => {
    expect(screen.queryByRole("tab", { name: detailsTab })).not.toBeInTheDocument();
  });
}

describe("Discover details and preview", () => {
  beforeEach(resetAppState);

  it("clicking the card selects the novel and opens the details tab", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await inspectBook(user);
    expect(within(panel).getByText(commonStrings.synopsis)).toBeInTheDocument();
    expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: queueTab })).toBeInTheDocument();
  });

  it("right-click opens details without adding the novel to the queue", async () => {
    await renderReadyApp();

    await openPreview();

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("The Enchanted Forest")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: discoverStrings.addToQueue })).not.toBeInTheDocument();
  });

  it("right-clicking another card replaces the previewed details", async () => {
    await renderReadyApp();

    await openPreview("The Enchanted Forest");
    await openPreview("Journey to the Unknown");

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });
  });

  it("keeps the queued selection when switching from details back to queue", async () => {
    const user = setupUser();
    await renderReadyApp();

    const detailPanel = await inspectBook(user);
    expect(within(detailPanel).getByText("The Enchanted Forest")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: queueTab }));

    await waitFor(() => {
      expect(within(getQueuePanel()).getByText("The Enchanted Forest")).toBeInTheDocument();
    });
  });

  it("shows the last selected novel in the details tab", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user, "The Enchanted Forest");
    await user.click(await findBookCardTitle("Journey to the Unknown"));

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });
  });

  it("pressing escape closes preview details when nothing is selected", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.keyDown(getContentArea(), { key: "Escape" });

    await expectPreviewClosed();
  });

  it("pressing escape closes preview details and restores queue-backed details", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user, "The Enchanted Forest");
    await openPreview("Journey to the Unknown");
    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });

    fireEvent.keyDown(getContentArea(), { key: "Escape" });

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("The Enchanted Forest")).toBeInTheDocument();
    });
  });

  it("deselects the novel when clicking the selected card again", async () => {
    const user = setupUser();
    await renderReadyApp();

    const title = await findBookCardTitle("The Enchanted Forest");
    await user.click(title);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: queueTab })).toBeInTheDocument();
    });

    await user.click(title);

    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: queueTab })).not.toBeInTheDocument();
    });
  });

  it("clicking the results background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getContentArea(), { target: getContentArea() });

    await expectPreviewClosed();
  });

  it("clicking the toolbar background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getToolbar(), { target: getToolbar() });

    await expectPreviewClosed();
  });

  it("clicking the active-filter-row background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getActiveFilterRow(), { target: getActiveFilterRow() });

    await expectPreviewClosed();
  });

  it("clicking the filter-panel background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getFilterPanel(), { target: getFilterPanel() });

    await expectPreviewClosed();
  });

  it("clicking a filter section background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getFirstFilterField(), { target: getFirstFilterField() });

    await expectPreviewClosed();
  });

  it("clicking controls while preview is open does not close it", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openPreview();
    await user.click(screen.getByRole("button", { name: commonStrings.hideFilters }));

    expect(within(getDetailPanel()).getByText("The Enchanted Forest")).toBeInTheDocument();
  });

  it("left-click while preview is open selects normally and clears the temporary preview", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openPreview("The Enchanted Forest");
    await user.click(await findBookCardTitle("Journey to the Unknown"));

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("tab", { name: queueTab }));
    await waitFor(() => {
      expect(within(getQueuePanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });
  });
});
