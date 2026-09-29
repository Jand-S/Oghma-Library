import { screen, waitFor, within } from "@testing-library/react";
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
  setupUser
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

async function openDownloads(user: ReturnType<typeof setupUser>) {
  await user.click(screen.getByRole("button", { name: navStrings.downloads }));
}

describe("Downloads", () => {
  beforeEach(resetAppState);

  it("lists finished jobs and clears them without requiring selection", async () => {
    const user = setupUser();
    const queue = createTestQueue({ runJob: instantRunner });
    queue.enqueue({ novelId: "whispers-night", title: "Whispers of the Night", request: request() });
    queue.enqueue({ novelId: "labyrinth", title: "The Labyrinth's Secret", request: request() });
    await queue.idle();
    await renderReadyApp(undefined, queue);

    await openDownloads(user);
    const completed = screen.getByTestId("downloads-completed");
    expect(within(completed).getByText("Whispers of the Night")).toBeInTheDocument();
    expect(within(completed).getByText("The Labyrinth's Secret")).toBeInTheDocument();
    expect(within(completed).getAllByTestId("download-row")).toHaveLength(2);
    expect(within(completed).getByRole("button", { name: downloadsStrings.openFolderLabel("Whispers of the Night") })).toBeInTheDocument();

    await user.click(within(completed).getByRole("button", { name: downloadsStrings.clearCompleted }));

    expect(screen.queryByText("Whispers of the Night")).not.toBeInTheDocument();
    expect(screen.queryByText("The Labyrinth's Secret")).not.toBeInTheDocument();
    expect(within(completed).queryAllByTestId("queue-item")).toHaveLength(0);
  });

  it("shows the active job with real progress and cancels it after confirmation", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "dark-storm", title: "Dark Storm", request: request() });

    await openDownloads(user);
    const active = await screen.findByTestId("download-active");
    expect(within(active).getByText("Dark Storm")).toBeInTheDocument();
    expect(within(active).getByTestId("download-progress")).toHaveTextContent("Baixando · 42% · 1,2 MB/s · 0:35");
    expect(within(active).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");

    await user.click(within(active).getByRole("button", { name: downloadsStrings.cancel }));
    const dialog = await screen.findByRole("dialog", { name: downloadsStrings.cancelConfirmTitle });
    expect(within(dialog).getByText(downloadsStrings.cancelConfirmDescription)).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: downloadsStrings.cancelConfirm }));

    await waitFor(() => expect(screen.queryByTestId("download-active")).not.toBeInTheDocument());
    const completed = screen.getByTestId("downloads-completed");
    expect(within(completed).getByText(downloadsStrings.canceled)).toBeInTheDocument();
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

  it("reorders and removes queued jobs, and pauses/resumes the queue", async () => {
    const user = setupUser();
    const queue = createTestQueue();
    await renderReadyApp(undefined, queue);
    queue.enqueue({ novelId: "a", title: "Livro A", request: request() });
    queue.enqueue({ novelId: "b", title: "Livro B", request: request() });
    queue.enqueue({ novelId: "c", title: "Livro C", request: request() });

    await openDownloads(user);
    const queuedTitles = () => screen.getAllByTestId("download-queued").map((row) => row.querySelector("strong")?.textContent);
    expect(queuedTitles()).toEqual(["Livro B", "Livro C"]);

    await user.click(screen.getByRole("button", { name: downloadsStrings.moveUp("Livro C") }));
    expect(queuedTitles()).toEqual(["Livro C", "Livro B"]);

    await user.click(screen.getByRole("button", { name: downloadsStrings.remove("Livro B") }));
    expect(queuedTitles()).toEqual(["Livro C"]);

    await user.click(screen.getByRole("button", { name: downloadsStrings.pause }));
    await waitFor(() => expect(screen.queryByTestId("download-active")).not.toBeInTheDocument());
    expect(queue.getSnapshot().paused).toBe(true);
    expect(queuedTitles()).toEqual(["Livro A", "Livro C"]);

    await user.click(screen.getByRole("button", { name: downloadsStrings.resume }));
    await waitFor(() => expect(within(screen.getByTestId("download-active")).getByText("Livro A")).toBeInTheDocument());
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
    await user.click(within(completed).getByRole("button", { name: downloadsStrings.retryLabel("Dark Storm") }));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.committed("Dark Storm"))).toBeInTheDocument());
    expect(queue.getSnapshot().completed.map((job) => job.status)).toEqual(["done"]);
  });
});
