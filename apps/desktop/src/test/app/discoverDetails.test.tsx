import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
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
  type TestUser
} from "../renderApp";

async function openPreview(title = "The Enchanted Forest") {
  fireEvent.contextMenu(await findBookCardTitle(title));
  await waitFor(() => expect(within(getDetailPanel()).getByText(title, { selector: "h2" })).toBeInTheDocument());
}

async function expectPanelClosed() {
  await waitFor(() => {
    expect(screen.queryByTestId("discover-sidebar")).not.toBeInTheDocument();
  });
}

async function pickStatus(user: TestUser, label: string) {
  await user.click(within(getFilterPanel()).getByRole("button", { name: new RegExp(`^${discoverStrings.status}`) }));
  await user.click(within(screen.getByRole("dialog", { name: discoverStrings.status })).getByRole("radio", { name: label }));
}

describe("Discover details and preview", () => {
  beforeEach(resetAppState);

  it("clicking the card selects it and shows details and the download actions in one panel", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await inspectBook(user);
    expect(within(panel).getByText(discoverStrings.synopsis)).toBeInTheDocument();
    expect(within(panel).getByTestId("detail-cover")).toBeInTheDocument();
    // No more Fila/Detalhes tabs: the configurator lives in the same panel.
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
    const actions = getQueuePanel();
    expect(within(screen.getByTestId("discover-sidebar")).getByTestId("queue-panel")).toBe(actions);
    expect(within(actions).getByTestId("add-to-queue")).toHaveTextContent(discoverStrings.addToQueue);
  });

  it("shows the synopsis before the tags", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await inspectBook(user, "The Enchanted Forest");
    const synopsis = within(panel).getByRole("heading", { name: discoverStrings.synopsis });
    const tags = within(panel).getByRole("heading", { name: discoverStrings.tags });
    expect(synopsis.compareDocumentPosition(tags) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("marks the selected card", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user, "The Enchanted Forest");
    expect(screen.getByRole("button", { name: discoverStrings.removeFromQueue("The Enchanted Forest") })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Desmarcar / })).toHaveLength(1);
  });

  it("right-click opens details without the download configurator", async () => {
    await renderReadyApp();

    await openPreview();

    expect(within(getDetailPanel()).getByText(discoverStrings.previewBadge)).toBeInTheDocument();
    expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: discoverStrings.addToQueue })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: discoverStrings.selectFromPreview })).toBeInTheDocument();
  });

  it("'Selecionar para baixar' turns the preview into the selection", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openPreview("Journey to the Unknown");
    await user.click(screen.getByRole("button", { name: discoverStrings.selectFromPreview }));

    await waitFor(() => expect(within(getQueuePanel()).getByText("Journey to the Unknown")).toBeInTheDocument());
    expect(screen.queryByText(discoverStrings.previewBadge)).not.toBeInTheDocument();
  });

  it("right-clicking another card replaces the previewed details", async () => {
    await renderReadyApp();

    await openPreview("The Enchanted Forest");
    await openPreview("Journey to the Unknown");

    expect(within(getDetailPanel()).queryByText("The Enchanted Forest")).not.toBeInTheDocument();
  });

  it("shows the last selected novel in the details panel", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user, "The Enchanted Forest");
    await user.click(await findBookCardTitle("Journey to the Unknown"));

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("Journey to the Unknown", { selector: "h2" })).toBeInTheDocument();
    });
    expect(within(getQueuePanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
  });

  it("pressing escape closes preview details when nothing is selected", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.keyDown(getContentArea(), { key: "Escape" });

    await expectPanelClosed();
  });

  it("pressing escape closes preview details and restores the selected book", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user, "The Enchanted Forest");
    await openPreview("Journey to the Unknown");

    fireEvent.keyDown(getContentArea(), { key: "Escape" });

    await waitFor(() => {
      expect(within(getDetailPanel()).getByText("The Enchanted Forest", { selector: "h2" })).toBeInTheDocument();
    });
    expect(getQueuePanel()).toBeInTheDocument();

    // A second Esc closes the selected book's panel too.
    fireEvent.keyDown(getContentArea(), { key: "Escape" });
    await expectPanelClosed();
  });

  it("the close button closes the panel", async () => {
    const user = setupUser();
    await renderReadyApp();

    await inspectBook(user);
    await user.click(screen.getByRole("button", { name: discoverStrings.closeDetails }));

    await expectPanelClosed();
  });

  it("deselects the novel when clicking the selected card again", async () => {
    const user = setupUser();
    await renderReadyApp();

    const title = await findBookCardTitle("The Enchanted Forest");
    await user.click(title);
    await waitFor(() => expect(getQueuePanel()).toBeInTheDocument());

    await user.click(title);

    await expectPanelClosed();
  });

  it("clicking the results background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getContentArea(), { target: getContentArea() });

    await expectPanelClosed();
  });

  it("clicking the toolbar background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getToolbar(), { target: getToolbar() });

    await expectPanelClosed();
  });

  it("clicking the active-filter-row background closes preview details", async () => {
    const user = setupUser();
    await renderReadyApp();
    await pickStatus(user, "Em andamento");

    await openPreview();
    fireEvent.click(getActiveFilterRow(), { target: getActiveFilterRow() });

    await expectPanelClosed();
  });

  it("clicking the filter-panel background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getFilterPanel(), { target: getFilterPanel() });

    await expectPanelClosed();
  });

  it("clicking a filter section background closes preview details", async () => {
    await renderReadyApp();

    await openPreview();
    fireEvent.click(getFirstFilterField(), { target: getFirstFilterField() });

    await expectPanelClosed();
  });

  it("clicking controls while preview is open does not close it", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openPreview();
    await user.click(within(getFilterPanel()).getByRole("button", { name: discoverStrings.tags }));
    const popover = screen.getByRole("dialog", { name: discoverStrings.tags });
    // A click on the popover's own background is not a "background" click either.
    fireEvent.click(popover, { target: popover });
    await user.click(await within(popover).findByRole("button", { name: /^Fantasia(,|$)/ }));

    expect(within(getDetailPanel()).getByText("The Enchanted Forest", { selector: "h2" })).toBeInTheDocument();
  });

  it("left-click while preview is open selects normally and clears the temporary preview", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openPreview("The Enchanted Forest");
    await user.click(await findBookCardTitle("Journey to the Unknown"));

    await waitFor(() => {
      expect(within(getQueuePanel()).getByText("Journey to the Unknown")).toBeInTheDocument();
    });
    expect(screen.queryByText(discoverStrings.previewBadge)).not.toBeInTheDocument();
  });
});
