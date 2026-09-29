import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { commonStrings } from "../../strings/common";
import { discoverStrings } from "../../strings/discover";
import {
  expandSelectionCard,
  queueFirstBook,
  renderReadyApp,
  resetAppState,
  setupUser
} from "../renderApp";

describe("Discover selection queue", () => {
  beforeEach(resetAppState);

  it("adds a novel to the queue from the card selector", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    expect(panel).toBeTruthy();
  });

  it("removes a selected novel when it is dropped on the trash target", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    fireEvent.pointerDown(within(panel).getByTestId("drag-handle"), { clientX: 10, clientY: 10 });

    const trash = screen.getByTestId("delete-overlay");
    expect(trash).toHaveTextContent(commonStrings.dropToRemove);
    vi.spyOn(screen.getByTestId("content-area"), "getBoundingClientRect").mockReturnValue({
      left: 100,
      right: 300,
      top: 100,
      bottom: 180,
      width: 200,
      height: 80,
      x: 100,
      y: 100,
      toJSON: () => ({})
    });

    fireEvent.pointerMove(window, { clientX: 150, clientY: 140 });
    expect(trash).toHaveAttribute("data-over", "true");
    fireEvent.pointerUp(window, { clientX: 150, clientY: 140 });

    await waitFor(() => expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument());
  });

  it("keeps the selection drawer open while queue items are animating", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    await expandSelectionCard(user, panel);

    await user.click(within(panel).getByRole("button", { name: discoverStrings.addToQueue }));

    expect(screen.getByRole("button", { name: commonStrings.sending })).toBeDisabled();
    expect(screen.getByTestId("queue-panel")).toBeInTheDocument();
    expect(within(panel).queryByText("The Enchanted Forest")).not.toBeInTheDocument();

    await waitFor(() => expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument(), { timeout: 3000 });
  });

  it("shows format chips and audiobook options in a draggable card", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    expect(within(panel).queryByText(commonStrings.formats)).not.toBeInTheDocument();

    await expandSelectionCard(user, panel);

    expect(within(panel).getByText(commonStrings.formats)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "EPUB" })).toBeInTheDocument();
    // Translation is not offered per download.
    expect(within(panel).queryByRole("button", { name: /Traduzir/i })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: new RegExp(commonStrings.audiobook) })).toBeInTheDocument();

    const card = within(panel).getByTestId("selection-card");
    expect(card.getAttribute("data-card-id")).toBeTruthy();
    expect(within(card).getByTestId("drag-handle")).toBeInTheDocument();
  });

  it("supports selecting multiple download formats", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    await expandSelectionCard(user, panel);
    const epub = within(panel).getByRole("button", { name: "EPUB" });
    const pdf = within(panel).getByRole("button", { name: "PDF" });

    expect(epub).toHaveAttribute("aria-pressed", "true");
    expect(pdf).toHaveAttribute("aria-pressed", "false");

    await user.click(pdf);

    expect(pdf).toHaveAttribute("aria-pressed", "true");
    expect(epub).toHaveAttribute("aria-pressed", "true");
  });

  it("defaults the chapter preset to Todos", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    await expandSelectionCard(user, panel);
    const all = within(panel).getByRole("button", { name: discoverStrings.presetAll });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByRole("button", { name: discoverStrings.presetRange })).toHaveAttribute("aria-pressed", "false");
  });
});
