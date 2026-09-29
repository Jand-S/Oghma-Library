import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { pageTitleStrings } from "../../strings/common";
import { kindlePageStrings } from "../../strings/kindle";
import {
  createTestQueue,
  getToastRegion,
  instantRunner,
  renderReadyApp,
  resetAppState,
  setupUser,
  type TestUser
} from "../renderApp";

const MOCKINGBIRD = "To Kill a Mockingbird";
const LOST_TEMPLE = "Mystery of the Lost Temple";

async function openKindle(user: TestUser) {
  await user.click(screen.getByTestId("nav-kindle"));
}

describe("Kindle page", () => {
  beforeEach(resetAppState);

  it("shows the connected device and sends the picked books in order", async () => {
    const user = setupUser();
    const queue = createTestQueue({ runJob: instantRunner });
    await renderReadyApp(undefined, queue);
    await openKindle(user);

    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.kindle })).toBeInTheDocument();
    expect(await screen.findByTestId("kindle-connected")).toHaveTextContent(kindlePageStrings.connected);

    const send = screen.getByTestId("kindle-send");
    expect(send).toBeDisabled();
    expect(screen.getByText(kindlePageStrings.emptyQueue)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(LOST_TEMPLE) }));
    await user.click(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(MOCKINGBIRD) }));
    expect(screen.getAllByTestId("library-queue-card")).toHaveLength(2);
    expect(send).toHaveTextContent(kindlePageStrings.send(2));

    await user.click(send);
    await waitFor(() => expect(queue.getSnapshot().completed).toHaveLength(2));
    // Completed jobs are newest first, so the first sent book is last.
    const completed = queue.getSnapshot().completed;
    expect(completed.map((job) => job.novelId)).toEqual(["enchanter-forest", "lost-temple"]);
    expect(completed.every((job) => job.kind === "convert" && job.request.formats.join() === "AZW3")).toBe(true);
    await waitFor(() => expect(within(getToastRegion()).getByText(/Envio direto ao Kindle/)).toBeInTheDocument());
  });

  it("reorders the send list with the keyboard and removes books from it", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openKindle(user);

    await user.click(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(MOCKINGBIRD) }));
    await user.click(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(LOST_TEMPLE) }));
    const list = screen.getByRole("list", { name: kindlePageStrings.queueLabel });
    const titles = () => within(list).getAllByTestId("library-queue-card").map((card) => card.querySelector("strong")?.textContent);
    expect(titles()).toEqual([MOCKINGBIRD, LOST_TEMPLE]);

    const firstItem = within(list).getAllByRole("listitem")[0];
    firstItem.focus();
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(titles()).toEqual([LOST_TEMPLE, MOCKINGBIRD]);

    await user.click(screen.getByRole("button", { name: kindlePageStrings.removeFromQueue(LOST_TEMPLE) }));
    expect(titles()).toEqual([MOCKINGBIRD]);
    expect(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(LOST_TEMPLE) })).not.toBeChecked();
  });

  it("explains how to connect when no Kindle is detected", async () => {
    const user = setupUser();
    const backend: BackendClient = {
      ...mockBackendClient,
      async getKindleStatus() {
        const status = await mockBackendClient.getKindleStatus();
        return { ...status, connected: false };
      }
    };
    await renderReadyApp(backend);
    await openKindle(user);

    expect(screen.getByTestId("kindle-disconnected")).toHaveTextContent(kindlePageStrings.disconnected);
    expect(screen.getByRole("heading", { name: kindlePageStrings.noDevice })).toBeInTheDocument();
    expect(screen.getByText(kindlePageStrings.tips[0])).toBeInTheDocument();
    expect(screen.queryByTestId("kindle-send")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: kindlePageStrings.openLibrary }));
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.library })).toBeInTheDocument();
  });
});
