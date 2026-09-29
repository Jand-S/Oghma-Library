import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { DownloadJobRequest } from "../../core/types";
import { navStrings } from "../../strings/common";
import { downloadsStrings } from "../../strings/downloads";
import {
  createTestQueue,
  getToastRegion,
  instantRunner,
  renderReadyApp,
  resetAppState,
  setupUser,
  type TestUser
} from "../renderApp";

function request(overrides: Partial<DownloadJobRequest> = {}): DownloadJobRequest {
  return {
    serverUrl: "https://b2.example",
    outputRoot: "/books",
    formats: ["EPUB"],
    preset: "all",
    rangeLabel: "Todos os capitulos",
    chaptersTotal: 10,
    translate: false,
    audiobook: false,
    ...overrides
  };
}

async function openDownloads(user: TestUser) {
  await user.click(screen.getByRole("button", { name: navStrings.downloads }));
}

const queuedTitles = () => screen.queryAllByTestId("download-queued").map((row) => row.querySelector("strong")?.textContent);

async function chooseQueueAction(user: TestUser, title: string, action: string) {
  await user.click(screen.getByRole("button", { name: downloadsStrings.queueActions(title) }));
  await user.click(await screen.findByRole("menuitem", { name: action }));
}

describe("Downloads", () => {
  beforeEach(resetAppState);

  it("shows an empty state that leads to Discover", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openDownloads(user);
    expect(await screen.findByRole("heading", { name: downloadsStrings.emptyTitle })).toBeInTheDocument();
    expect(screen.getByText(downloadsStrings.emptyDescription)).toBeInTheDocument();
    expect(screen.queryByTestId("downloads-pending")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: downloadsStrings.goToDiscover }));
    expect(screen.getByTestId("nav-discover")).toHaveAttribute("aria-current", "page");
  });

  it("lists finished jobs and clears them without requiring selection", async () => {
    const user = setupUser();
    const queue = createTestQueue({ runJob: instantRunner });
    queue.enqueue({ novelId: "whispers-night", title: "Whispers of the Night", request: request({ formats: ["EPUB", "AZW3"] }) });
    queue.enqueue({ novelId: "labyrinth", title: "The Labyrinth's Secret", request: request() });
    await queue.idle();
    await renderReadyApp(undefined, queue);

    await openDownloads(user);
    expect(screen.getByTestId("downloads-count")).toHaveTextContent(downloadsStrings.pendingCount(0));
    const completed = await screen.findByTestId("downloads-completed");
    expect(within(completed).getByText("Whispers of the Night")).toBeInTheDocument();
    expect(within(completed).getByText("The Labyrinth's Secret")).toBeInTheDocument();
    const rows = within(completed).getAllByTestId("download-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getAllByText(downloadsStrings.done).length).toBeGreaterThan(0);
    // Old unaccented range labels are rebuilt with accents.
    expect(within(completed).getAllByText(downloadsStrings.allChapters(10))).toHaveLength(2);
    const whispers = rows.find((row) => within(row).queryByText("Whispers of the Night"))!;
    expect(within(whispers).getByText("AZW3")).toHaveAttribute("title", "Whispers of the Night.azw3");
    expect(within(completed).getByRole("button", { name: downloadsStrings.openFolderLabel("Whispers of the Night") })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: downloadsStrings.clearCompleted }));

    expect(screen.queryByText("Whispers of the Night")).not.toBeInTheDocument();
    expect(screen.queryByText("The Labyrinth's Secret")).not.toBeInTheDocument();
    expect(screen.queryByTestId("downloads-completed")).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("queue-item")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: downloadsStrings.emptyTitle })).toBeInTheDocument();
  });

  it("shows the active job with real progress and cancels it after confirmation", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "dark-storm", title: "Dark Storm", request: request() });

    await openDownloads(user);
    const active = await screen.findByTestId("download-active");
    expect(within(active).getByText("Dark Storm")).toBeInTheDocument();
    const bar = within(within(active).getByTestId("download-progress")).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", expect.stringContaining("Baixando · 42% · 1,2 MB/s · 0:35"));
    expect(within(active).getByText("1,2 MB/s")).toBeInTheDocument();
    expect(within(active).getByText(downloadsStrings.remaining("0:35"))).toBeInTheDocument();
    expect(screen.getByTestId("downloads-count")).toHaveTextContent(downloadsStrings.pendingCount(1));

    await user.click(within(active).getByRole("button", { name: downloadsStrings.cancel }));
    const dialog = await screen.findByRole("dialog", { name: downloadsStrings.cancelConfirmTitle });
    expect(within(dialog).getByText(downloadsStrings.cancelConfirmDescription)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: downloadsStrings.cancelConfirm }));

    await waitFor(() => expect(screen.queryByTestId("download-active")).not.toBeInTheDocument());
    const completed = screen.getByTestId("downloads-completed");
    expect(within(completed).getByText(downloadsStrings.canceled)).toBeInTheDocument();
    expect(within(completed).getByRole("button", { name: downloadsStrings.retryLabel("Dark Storm") })).toBeInTheDocument();
    expect(within(getToastRegion()).getByText(downloadsStrings.canceledToast("Dark Storm"))).toBeInTheDocument();
    expect(queue.getSnapshot().completed[0]?.status).toBe("canceled");
  });

  it("keeps the download running when the cancel confirmation is dismissed", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "dark-storm", title: "Dark Storm", request: request() });

    await openDownloads(user);
    const active = await screen.findByTestId("download-active");
    await user.click(within(active).getByRole("button", { name: downloadsStrings.cancel }));
    const dialog = await screen.findByRole("dialog", { name: downloadsStrings.cancelConfirmTitle });
    await user.click(within(dialog).getByRole("button", { name: downloadsStrings.keepDownloading }));

    expect(screen.getByTestId("download-active")).toBeInTheDocument();
    expect(queue.getSnapshot().active?.status).toBe("downloading");
  });

  it("feeds the bottom panel with the active job and the queue size", async () => {
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "a", title: "Livro A", request: request() });
    queue.enqueue({ novelId: "b", title: "Livro B", request: request() });
    queue.enqueue({ novelId: "c", title: "Livro C", request: request() });

    const footer = screen.getByRole("contentinfo");
    await waitFor(() => expect(footer).toHaveTextContent("Livro A… 42% · 1,2 MB/s · 0:35"));
    expect(footer).toHaveTextContent("2 na fila");
  });

  it("reorders and removes queued jobs from the row menu and the keyboard", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    for (const id of ["A", "B", "C", "D"]) queue.enqueue({ novelId: id, title: `Livro ${id}`, request: request() });

    await openDownloads(user);
    expect(queuedTitles()).toEqual(["Livro B", "Livro C", "Livro D"]);
    expect(screen.getByText(downloadsStrings.queuedNote)).toBeInTheDocument();
    expect(screen.getByTestId("downloads-count")).toHaveTextContent(downloadsStrings.pendingCount(4));

    await chooseQueueAction(user, "Livro C", downloadsStrings.moveUpItem);
    expect(queuedTitles()).toEqual(["Livro C", "Livro B", "Livro D"]);

    await chooseQueueAction(user, "Livro D", downloadsStrings.moveTop);
    expect(queuedTitles()).toEqual(["Livro D", "Livro C", "Livro B"]);

    await user.click(screen.getByRole("button", { name: downloadsStrings.queueActions("Livro D") }));
    expect(await screen.findByRole("menuitem", { name: downloadsStrings.moveUpItem })).toBeDisabled();
    await user.keyboard("{Escape}");

    const item = screen.getByRole("listitem", { name: "Livro D" });
    fireEvent.keyDown(item, { key: "ArrowDown", altKey: true });
    expect(queuedTitles()).toEqual(["Livro C", "Livro D", "Livro B"]);
    expect(queue.getSnapshot().queued.map((job) => job.title)).toEqual(["Livro C", "Livro D", "Livro B"]);

    await chooseQueueAction(user, "Livro B", downloadsStrings.removeFromQueue);
    expect(queuedTitles()).toEqual(["Livro C", "Livro D"]);
  });

  it("pauses the queue into a paused hero card and resumes it", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "a", title: "Livro A", request: request() });
    queue.enqueue({ novelId: "b", title: "Livro B", request: request() });

    await openDownloads(user);
    await user.click(screen.getByRole("button", { name: downloadsStrings.pauseQueue }));
    await waitFor(() => expect(screen.queryByTestId("download-active")).not.toBeInTheDocument());
    expect(queue.getSnapshot().paused).toBe(true);
    const pausedCard = screen.getByTestId("download-paused");
    expect(within(pausedCard).getByText("Livro A")).toBeInTheDocument();
    expect(screen.getByText(downloadsStrings.queuePaused)).toBeInTheDocument();
    expect(queuedTitles()).toEqual(["Livro B"]);

    await user.click(within(pausedCard).getByRole("button", { name: downloadsStrings.resume }));
    await waitFor(() => expect(within(screen.getByTestId("download-active")).getByText("Livro A")).toBeInTheDocument());

    await user.click(within(screen.getByTestId("download-active")).getByRole("button", { name: downloadsStrings.pause }));
    await waitFor(() => expect(screen.getByTestId("download-paused")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: downloadsStrings.resumeQueue }));
    await waitFor(() => expect(screen.getByTestId("download-active")).toBeInTheDocument());
    expect(queue.getSnapshot().paused).toBe(false);
  });

  it("shows a full queue of 10 with positions", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    for (let index = 0; index <= 10; index += 1) {
      queue.enqueue({ novelId: `n${index}`, title: `Livro ${index}`, request: request() });
    }

    await openDownloads(user);
    await screen.findByTestId("download-active");
    expect(screen.getAllByTestId("download-queued")).toHaveLength(10);
    expect(screen.getByLabelText(downloadsStrings.positionLabel(10))).toHaveTextContent("10");
    expect(screen.getByTestId("downloads-count")).toHaveTextContent(downloadsStrings.pendingCount(11));
  });

  it("retries a failed job", async () => {
    const user = setupUser();
    let attempts = 0;
    const queue = createTestQueue({
      runJob: async (job) => {
        attempts += 1;
        if (attempts === 1) throw new Error("rede caiu");
        return { finalDir: `/books/${job.title}`, outputFiles: [] };
      }
    });
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "dark-storm", title: "Dark Storm", request: request() });
    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.failedToast("Dark Storm", "rede caiu"))).toBeInTheDocument());

    await openDownloads(user);
    const completed = screen.getByTestId("downloads-completed");
    expect(within(completed).getByText("rede caiu")).toBeInTheDocument();
    expect(within(completed).getByText(downloadsStrings.failedBadge)).toBeInTheDocument();
    await user.click(within(completed).getByRole("button", { name: downloadsStrings.retryLabel("Dark Storm") }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.committed("Dark Storm"))).toBeInTheDocument());
    expect(queue.getSnapshot().completed.map((job) => job.status)).toEqual(["done"]);
  });

  it("groups failures apart from finished jobs", async () => {
    const user = setupUser();
    const queue = createTestQueue({
      runJob: async (job) => {
        if (job.novelId === "bad") throw new Error("HTTP 503");
        return { finalDir: `/books/${job.title}`, outputFiles: [] };
      }
    });
    queue.enqueue({ novelId: "ok", title: "Livro Bom", request: request() });
    queue.enqueue({ novelId: "bad", title: "Livro Ruim", request: request() });
    await queue.idle();
    await renderReadyApp(undefined, queue);

    await openDownloads(user);
    const failures = screen.getByRole("list", { name: downloadsStrings.failedGroup });
    expect(within(failures).getByText("Livro Ruim")).toBeInTheDocument();
    expect(within(failures).getByText("HTTP 503")).toBeInTheDocument();
    const finished = screen.getByRole("list", { name: downloadsStrings.finishedGroup });
    expect(within(finished).getByText("Livro Bom")).toBeInTheDocument();
  });
});
