import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { commonStrings, navStrings } from "../../strings/common";
import { discoverStrings } from "../../strings/discover";
import { downloadsStrings } from "../../strings/downloads";
import {
  createTestQueue,
  findBookCardTitle,
  getToastRegion,
  queueFirstBook,
  renderReadyApp,
  resetAppState,
  setupUser
} from "../renderApp";

describe("Discover single selection and enqueue", () => {
  beforeEach(resetAppState);

  it("selects a novel from the card selector and shows its configurator", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
    expect(within(panel).getAllByTestId("selection-card")).toHaveLength(1);
    expect(within(panel).getByRole("button", { name: discoverStrings.addToQueue })).toBeEnabled();
  });

  it("keeps only one selected book: selecting another replaces it", async () => {
    const user = setupUser();
    await renderReadyApp();

    await queueFirstBook(user, "The Enchanted Forest");
    await user.click(screen.getByRole("button", { name: discoverStrings.selectForQueue("Journey to the Unknown") }));

    const panel = screen.getByTestId("queue-panel");
    await waitFor(() => expect(within(panel).getByText("Journey to the Unknown")).toBeInTheDocument());
    expect(within(panel).queryByText("The Enchanted Forest")).not.toBeInTheDocument();
    expect(within(panel).getAllByTestId("selection-card")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Desmarcar / })).toHaveLength(1);
    // No reordering or drag-to-trash in Discover anymore.
    expect(screen.queryByTestId("drag-handle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("delete-overlay")).not.toBeInTheDocument();
  });

  it("enqueues the selected book, starts it and clears the selection", async () => {
    const user = setupUser();
    const { queue } = await renderReadyApp();

    const panel = await queueFirstBook(user);
    await user.click(within(panel).getByRole("button", { name: discoverStrings.addToQueue }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.started)).toBeInTheDocument());
    expect(queue.getSnapshot().active?.title).toBe("The Enchanted Forest");
    await waitFor(() => expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument());
    // The bottom panel shows the real progress of the active job.
    expect(screen.getByText(/Baixando The Enchanted Forest… 42% · 1,2 MB\/s · 0:35/)).toBeInTheDocument();
  });

  it("says 'Adicionado à fila' when another download is already running", async () => {
    const user = setupUser();
    const { queue } = await renderReadyApp();

    await user.click(await screen.findByRole("button", { name: discoverStrings.selectForQueue("The Enchanted Forest") }));
    await user.click(screen.getByRole("button", { name: discoverStrings.addToQueue }));
    await waitFor(() => expect(queue.getSnapshot().active).not.toBeNull());

    await user.click(screen.getByRole("button", { name: discoverStrings.selectForQueue("Journey to the Unknown") }));
    await user.click(screen.getByRole("button", { name: discoverStrings.addToQueue }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.added)).toBeInTheDocument());
    expect(queue.getSnapshot().queued.map((job) => job.title)).toEqual(["Journey to the Unknown"]);
  });

  it("warns when the book is already in the queue", async () => {
    const user = setupUser();
    const { queue } = await renderReadyApp();

    await user.click(await screen.findByRole("button", { name: discoverStrings.selectForQueue("The Enchanted Forest") }));
    await user.click(screen.getByRole("button", { name: discoverStrings.addToQueue }));
    await waitFor(() => expect(queue.getSnapshot().active).not.toBeNull());

    await user.click(screen.getByRole("button", { name: discoverStrings.selectForQueue("The Enchanted Forest") }));
    const panel = screen.getByTestId("queue-panel");
    expect(within(panel).getByTestId("selection-hint")).toHaveTextContent(discoverStrings.alreadyQueuedHint);
    await user.click(within(panel).getByRole("button", { name: discoverStrings.addToQueue }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.duplicate)).toBeInTheDocument());
    expect(queue.getSnapshot().queued).toHaveLength(0);
    // The selection stays so the user can change it.
    expect(screen.getByTestId("queue-panel")).toBeInTheDocument();
  });

  it("warns when the queue is full", async () => {
    const user = setupUser();
    await renderReadyApp(undefined, createTestQueue({ maxQueued: 0 }));

    await queueFirstBook(user);
    await user.click(screen.getByRole("button", { name: discoverStrings.addToQueue }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.full)).toBeInTheDocument());
  });

  it("offers 'Baixar novamente' when the book is already in the library", async () => {
    const user = setupUser();
    await renderReadyApp();

    await findBookCardTitle("Mystery of the Lost Temple");
    await user.click(screen.getByRole("button", { name: discoverStrings.selectForQueue("Mystery of the Lost Temple") }));

    const panel = screen.getByTestId("queue-panel");
    expect(within(panel).getByRole("button", { name: discoverStrings.downloadAgain })).toBeEnabled();
    expect(within(panel).getByTestId("selection-hint")).toHaveTextContent(discoverStrings.replaceHint);
  });

  it("flashes the new job into the Downloads view", async () => {
    const user = setupUser();
    await renderReadyApp();

    await queueFirstBook(user);
    await user.click(screen.getByRole("button", { name: discoverStrings.addToQueue }));
    await waitFor(() => expect(screen.queryByTestId("queue-panel")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: navStrings.downloads }));
    expect(within(screen.getByTestId("download-active")).getByText("The Enchanted Forest")).toBeInTheDocument();
  });

  it("shows format chips and audiobook options for the selected book", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);

    expect(within(panel).getByText(commonStrings.formats)).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "EPUB" })).toBeInTheDocument();
    // Translation is not offered per download.
    expect(within(panel).queryByRole("button", { name: /Traduzir/i })).not.toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: new RegExp(commonStrings.audiobook) })).toBeInTheDocument();
  });

  it("supports selecting multiple download formats", async () => {
    const user = setupUser();
    await renderReadyApp();

    const panel = await queueFirstBook(user);
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
    const all = within(panel).getByRole("button", { name: discoverStrings.presetAll });
    expect(all).toHaveAttribute("aria-pressed", "true");
    expect(within(panel).getByRole("button", { name: discoverStrings.presetRange })).toHaveAttribute("aria-pressed", "false");
  });
});
