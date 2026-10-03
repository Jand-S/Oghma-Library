import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../App";
import { defaultAppConfig } from "../../core/appConfig";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { navStrings, pageTitleStrings } from "../../strings/common";
import { downloadsStrings } from "../../strings/downloads";
import { libraryStrings } from "../../strings/library";
import {
  createTestQueue,
  getLibraryCard,
  getToastRegion,
  instantRunner,
  renderReadyApp,
  resetAppState,
  seedSetup,
  setupUser,
  type TestUser
} from "../renderApp";

const MOCKINGBIRD = "To Kill a Mockingbird";
const LOST_TEMPLE = "Mystery of the Lost Temple";

async function openLibrary(user: TestUser) {
  await user.click(screen.getByRole("button", { name: navStrings.library }));
  await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
}

function cardTitles() {
  return screen.queryAllByTestId("library-card").map((card) => within(card).getByTestId("card-title").textContent);
}

async function openDetails(user: TestUser, title: string) {
  await user.click(getLibraryCard(title).title);
  return screen.getByTestId("library-detail");
}

function openContextMenu(title: string) {
  fireEvent.contextMenu(getLibraryCard(title).card, { clientX: 40, clientY: 40 });
  return screen.getByRole("menu");
}

describe("Library browsing", () => {
  beforeEach(resetAppState);

  it("shows cover cards with their formats and opens the details page", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);

    expect(screen.getByTestId("library-count")).toHaveTextContent(libraryStrings.count(2));
    const { card } = getLibraryCard(MOCKINGBIRD);
    expect(within(card).getByRole("img", { name: MOCKINGBIRD })).toHaveAttribute("src", expect.stringContaining("oghma-icon.svg"));
    expect(within(getLibraryCard(LOST_TEMPLE).card).getByText("EPUB · PDF")).toBeInTheDocument();

    const details = await openDetails(user, MOCKINGBIRD);
    expect(within(details).getByRole("heading", { level: 2, name: MOCKINGBIRD })).toBeInTheDocument();
    expect(within(details).getByRole("heading", { name: libraryStrings.synopsis })).toBeInTheDocument();
    expect(within(within(details).getByTestId("detail-cover")).getByRole("img")).toHaveAttribute("src", expect.stringContaining("oghma-icon.svg"));
    expect(within(details).getByRole("heading", { name: libraryStrings.dangerZone })).toBeInTheDocument();
    // Sending to the Kindle lives on the Kindle page; the library opens the folder.
    expect(within(details).getByRole("button", { name: libraryStrings.openFolder })).toBeInTheDocument();
    expect(within(details).queryByRole("button", { name: /Kindle/ })).not.toBeInTheDocument();

    // The shell back button returns to the grid.
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(screen.queryByTestId("library-detail")).not.toBeInTheDocument();
    expect(cardTitles()).toHaveLength(2);
  });

  it("filters by search and format, and offers to clear filters when nothing matches", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);

    await user.type(screen.getByRole("searchbox", { name: libraryStrings.searchLabel }), "temple");
    expect(cardTitles()).toEqual([LOST_TEMPLE]);
    expect(screen.getByTestId("library-count")).toHaveTextContent(libraryStrings.countFiltered(1, 2));

    await user.type(screen.getByRole("searchbox", { name: libraryStrings.searchLabel }), "zzz");
    expect(screen.getByRole("heading", { name: libraryStrings.noMatchTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: libraryStrings.clearFilters }));
    expect(cardTitles()).toHaveLength(2);

    const filters = screen.getByRole("group", { name: libraryStrings.formatFilterLabel });
    await user.click(within(filters).getByRole("button", { name: "PDF" }));
    expect(within(filters).getByRole("button", { name: "PDF" })).toHaveAttribute("aria-pressed", "true");
    expect(cardTitles()).toEqual([LOST_TEMPLE]);
  });

  it("sorts by title and switches to the list view", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);

    await user.selectOptions(screen.getByRole("combobox", { name: libraryStrings.sortLabel }), "title");
    expect(cardTitles()).toEqual([LOST_TEMPLE, MOCKINGBIRD]);

    await user.click(screen.getByRole("radio", { name: libraryStrings.viewList }));
    expect(screen.queryAllByTestId("library-card")).toHaveLength(0);
    const rows = screen.getAllByTestId("library-row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]).getByText("15 MB")).toBeInTheDocument();
  });

  it("shows the empty library state with a way to Buscar", async () => {
    const user = setupUser();
    const backend: BackendClient = {
      ...mockBackendClient,
      async bootstrap() {
        const payload = await mockBackendClient.bootstrap();
        return { ...payload, library: [] };
      }
    };
    await renderReadyApp(backend);
    await user.click(screen.getByRole("button", { name: navStrings.library }));

    expect(screen.getByRole("heading", { name: libraryStrings.emptyTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: libraryStrings.emptyAction }));
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.discover })).toBeInTheDocument();
  });

  it("asks to configure the output folder when it is empty", async () => {
    const user = setupUser();
    seedSetup({ ...defaultAppConfig(["central-novel", "novel-mania"]), outputPath: "" });
    render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: navStrings.library })).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: navStrings.library }));

    expect(await screen.findByRole("heading", { name: libraryStrings.noOutputTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: libraryStrings.noOutputAction }));
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.settings })).toBeInTheDocument();
  });
});

describe("Library actions", () => {
  beforeEach(resetAppState);

  it("re-downloads a library book from the catalog and marks it as updating", async () => {
    const user = setupUser();
    const { queue } = await renderReadyApp();
    await openLibrary(user);
    const details = await openDetails(user, LOST_TEMPLE);
    await user.click(within(details).getByTestId("library-redownload"));

    await waitFor(() => expect(within(getToastRegion()).getByText(downloadsStrings.started)).toBeInTheDocument());
    expect(queue.getSnapshot().active).toMatchObject({ novelId: "lost-temple", kind: "download" });
    await waitFor(() => expect(within(details).getByTestId("library-redownload")).toBeDisabled());
    expect(within(details).getByRole("status")).toHaveTextContent(/Atualizando/);

    await user.click(screen.getByRole("button", { name: "Voltar" }));
    expect(within(getLibraryCard(LOST_TEMPLE).card).getByTestId("library-job-badge")).toHaveTextContent(/Atualizando/);
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
    await openLibrary(user);
    const details = await openDetails(user, LOST_TEMPLE);
    const button = within(details).getByTestId("library-redownload");
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", libraryStrings.notInCatalog);
  });

  it("offers every action in the right-click menu and hides a book after confirmation", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);

    const menu = openContextMenu(MOCKINGBIRD);
    for (const label of [
      libraryStrings.openDetails,
      libraryStrings.openFolder,
      libraryStrings.downloadAgain,
      libraryStrings.convertFormats,
      libraryStrings.removeFromLibrary,
      libraryStrings.deleteFiles
    ]) {
      expect(within(menu).getByRole("menuitem", { name: label })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole("menuitem", { name: /Kindle/ })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole("menuitem", { name: libraryStrings.removeFromLibrary }));

    const dialog = screen.getByRole("dialog", { name: libraryStrings.confirmRemoveTitle(MOCKINGBIRD) });
    expect(dialog).toHaveTextContent(libraryStrings.confirmRemoveDescription);
    await user.click(within(dialog).getByRole("button", { name: libraryStrings.confirmRemove }));

    await waitFor(() => expect(cardTitles()).toEqual([LOST_TEMPLE]));
    expect(within(getToastRegion()).getByText(libraryStrings.hiddenToast(1))).toBeInTheDocument();
  });

  it("a book removed from the library can be found under Ocultos and brought back", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);
    const hiddenChip = () => screen.queryByRole("button", { name: /^Ocultos/ });
    expect(hiddenChip()).not.toBeInTheDocument();

    await user.click(within(openContextMenu(MOCKINGBIRD)).getByRole("menuitem", { name: libraryStrings.removeFromLibrary }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: libraryStrings.confirmRemove }));
    await waitFor(() => expect(cardTitles()).toEqual([LOST_TEMPLE]));

    const chip = hiddenChip();
    expect(chip).toHaveTextContent(libraryStrings.hiddenFilter(1));
    await user.click(chip!);
    await waitFor(() => expect(cardTitles()).toEqual([MOCKINGBIRD]));

    const details = await openDetails(user, MOCKINGBIRD);
    await user.click(within(details).getByTestId("library-unhide"));
    expect(within(getToastRegion()).getByText(libraryStrings.unhiddenToast(MOCKINGBIRD))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(hiddenChip()).not.toBeInTheDocument());
    await waitFor(() => expect(cardTitles().sort()).toEqual([LOST_TEMPLE, MOCKINGBIRD].sort()));
  });

  it("deletes files only after a danger confirmation", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openLibrary(user);
    const details = await openDetails(user, LOST_TEMPLE);

    const dangerZone = within(details).getByRole("region", { name: libraryStrings.dangerZone });
    await user.click(within(dangerZone).getByRole("button", { name: libraryStrings.deleteFiles }));
    const dialog = screen.getByRole("dialog", { name: libraryStrings.confirmDeleteTitle(LOST_TEMPLE) });
    // Danger confirmations focus Cancel first.
    expect(within(dialog).getByRole("button", { name: "Cancelar" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: libraryStrings.confirmDelete }));

    // Outside Tauri there is nothing to delete: the book stays and the user is told why.
    await waitFor(() => expect(within(getToastRegion()).getByText(libraryStrings.deleteDesktopOnly)).toBeInTheDocument());
    expect(screen.getByTestId("library-detail")).toBeInTheDocument();
  });

  it("converts missing formats as a convert job in the download queue", async () => {
    const user = setupUser();
    const queue = createTestQueue({ runJob: instantRunner });
    await renderReadyApp(undefined, queue);
    await openLibrary(user);

    const menu = openContextMenu(MOCKINGBIRD);
    await user.click(within(menu).getByRole("menuitem", { name: libraryStrings.convertFormats }));
    const dialog = screen.getByRole("dialog", { name: libraryStrings.convertTitle(MOCKINGBIRD) });
    expect(within(dialog).getByRole("button", { name: /EPUB/ })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "AZW3" }));
    await user.click(within(dialog).getByRole("button", { name: libraryStrings.convertStart }));

    await waitFor(() => expect(queue.getSnapshot().completed).toHaveLength(1));
    expect(queue.getSnapshot().completed[0]).toMatchObject({ kind: "convert", novelId: "enchanter-forest", status: "done" });
    expect(queue.getSnapshot().completed[0].request.formats).toContain("AZW3");
    await waitFor(() => expect(within(getToastRegion()).getByText(libraryStrings.conversionDone)).toBeInTheDocument());
  });

});
