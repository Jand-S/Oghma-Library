import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { ImportApi, ImportPreview, ImportResult, PickedFile } from "../../services/importClient";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { navStrings, pageTitleStrings } from "../../strings/common";
import { importEpubStrings } from "../../strings/importEpub";
import { libraryStrings } from "../../strings/library";
import { createTestQueue, defaultBookTitle, findBookCardTitle, getToastRegion, resetAppState, seedSetup, setupUser } from "../renderApp";

// The mock catalog has "The Enchanted Forest" by Emily Bronte: a series with that name and no
// author in the EPUB gets her as the suggested author.
const SERIES = defaultBookTitle;
const PNG = "\x89PNG\r\n\x1a\n";

function preview(partial: Partial<ImportPreview> & Pick<ImportPreview, "id">): ImportPreview {
  return {
    fileName: `${partial.id}.epub`,
    sha256: partial.id.padEnd(64, "0"),
    size: 2048,
    title: "Caged Sparrow",
    author: null,
    language: null,
    series: { id: "series:the-enchanted-forest", name: SERIES, volume: 1 },
    seriesSource: "filename",
    coverDataUrl: null,
    coverFromLibrary: null,
    alreadyImported: null,
    error: null,
    ...partial
  };
}

const previews = [
  preview({ id: "noCover", fileName: `${SERIES} - Volume 1 - Caged Sparrow.epub` }),
  preview({ id: "withCover", title: "Second", author: "Autora B", seriesSource: "calibre", coverDataUrl: "data:image/png;base64,AAAA", series: { id: "series:the-enchanted-forest", name: SERIES, volume: 2 } }),
  preview({ id: "again", title: "Old", alreadyImported: { outputDir: "/out/Old" } }),
  preview({ id: "broken", title: "broken", series: null, seriesSource: null, error: "invalid_epub" })
];

function fakeApi() {
  let dropped: ((files: PickedFile[]) => void) | null = null;
  let hovered: ((active: boolean) => void) | null = null;
  let menu: (() => void) | null = null;
  const picked: PickedFile[] = previews.map(({ id, fileName, size }) => ({ id, fileName, size }));
  const api = {
    available: true,
    pick: vi.fn(async () => picked),
    preview: vi.fn(async (ids: string[]) => previews.filter((item) => ids.includes(item.id))),
    commit: vi.fn(async (items: { id: string }[]): Promise<ImportResult[]> => items.map((item) => ({ id: item.id, key: `import:${item.id}`, outputDir: `/out/${item.id}`, error: null }))),
    upload: vi.fn(),
    download: vi.fn(),
    usage: vi.fn(),
    onDropped: vi.fn(async (handler: (files: PickedFile[]) => void) => {
      dropped = handler;
      return () => {
        dropped = null;
      };
    }),
    onDragHover: vi.fn(async (handler: (active: boolean) => void) => {
      hovered = handler;
      return () => {
        hovered = null;
      };
    }),
    onMenuImport: vi.fn(async (handler: () => void) => {
      menu = handler;
      return () => {
        menu = null;
      };
    }),
    onFileProgress: vi.fn(async () => () => undefined)
  } satisfies ImportApi;
  return {
    api,
    drop: (files: PickedFile[]) => act(() => dropped?.(files)),
    hover: (active: boolean) => act(() => hovered?.(active)),
    chooseMenu: () => act(() => menu?.()),
    picked
  };
}

async function renderWith(api: ImportApi, backend: BackendClient = mockBackendClient) {
  seedSetup();
  render(<App backend={backend} downloadQueue={createTestQueue()} importApi={api} />);
  if (backend === mockBackendClient) await findBookCardTitle(defaultBookTitle);
}

function rowOf(fileName: string) {
  return screen.getAllByTestId("import-item").find((row) => row.getAttribute("aria-label") === fileName)!;
}

beforeEach(() => {
  resetAppState();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    fillRect: () => undefined,
    fillText: () => undefined,
    measureText: (text: string) => ({ width: text.length * 20 })
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(`data:image/png;base64,${btoa(PNG)}`);
});

afterEach(() => vi.restoreAllMocks());

describe("Importar EPUB", () => {
  it("previews the picked files, lets the reader edit them and imports the valid ones", async () => {
    const user = setupUser();
    const { api } = fakeApi();
    await renderWith(api);
    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await user.click(await screen.findByRole("button", { name: importEpubStrings.button }));

    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(4));
    expect(api.preview).toHaveBeenCalledWith(["noCover", "withCover", "again", "broken"]);

    // No author in the EPUB: the catalog novel named like the series suggests one.
    const first = rowOf(`${SERIES} - Volume 1 - Caged Sparrow.epub`);
    expect(within(first).getByLabelText(importEpubStrings.authorLabel)).toHaveValue("Emily Bronte");
    expect(within(first).getByText(importEpubStrings.authorFromCatalog)).toBeInTheDocument();
    expect(within(first).getByText(importEpubStrings.seriesSource.filename)).toBeInTheDocument();
    expect(within(first).getByText(importEpubStrings.coverGenerated)).toBeInTheDocument();
    expect(within(first).getByRole("img")).toHaveAttribute("src", expect.stringMatching(/^data:image\/png/));
    expect(within(rowOf("withCover.epub")).getByText(importEpubStrings.seriesSource.calibre)).toBeInTheDocument();
    expect(within(rowOf("again.epub")).getByText(importEpubStrings.alreadyImported)).toBeInTheDocument();
    expect(within(rowOf("broken.epub")).getByTestId("import-error")).toHaveTextContent("invalid_epub");

    const title = within(first).getByLabelText(importEpubStrings.titleLabel);
    await user.clear(title);
    await user.type(title, "Pardal Engaiolado");
    const volume = within(rowOf("withCover.epub")).getByLabelText(importEpubStrings.volumeLabel);
    await user.clear(volume);
    await user.type(volume, "2,5");

    await user.click(within(sheet).getByRole("button", { name: importEpubStrings.commit(2) }));
    await waitFor(() => expect(api.commit).toHaveBeenCalledTimes(1));
    expect(api.commit).toHaveBeenCalledWith([
      {
        id: "noCover",
        title: "Pardal Engaiolado",
        author: "Emily Bronte",
        series: { name: SERIES, volume: 1 },
        coverPng: Array.from(PNG, (char) => char.charCodeAt(0))
      },
      { id: "withCover", title: "Second", author: "Autora B", series: { name: SERIES, volume: 2.5 }, coverPng: null }
    ]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: importEpubStrings.sheetTitle })).not.toBeInTheDocument());
    expect(within(getToastRegion()).getByText(importEpubStrings.imported(2))).toBeInTheDocument();
  });

  it("opens the sheet for files dropped on the window, on any page", async () => {
    const { api, drop, picked } = fakeApi();
    await renderWith(api);
    await waitFor(() => expect(api.onDropped).toHaveBeenCalled());

    drop(picked.slice(2, 3));
    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(1));
    expect(api.preview).toHaveBeenCalledWith(["again"]);
    // Already in the library: nothing to import.
    expect(within(sheet).getByRole("button", { name: importEpubStrings.commit(0) })).toBeDisabled();
  });

  it("keeps the files that failed in the sheet with their error", async () => {
    const user = setupUser();
    const { api, drop, picked } = fakeApi();
    api.commit.mockImplementation(async (items: { id: string }[]) => items.map((item) => ({
      id: item.id,
      key: `import:${item.id}`,
      outputDir: item.id === "noCover" ? null : `/out/${item.id}`,
      error: item.id === "noCover" ? "disk_full" : null
    })));
    await renderWith(api);
    await waitFor(() => expect(api.onDropped).toHaveBeenCalled());
    drop(picked.slice(0, 2));
    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(2));

    await user.click(within(sheet).getByRole("button", { name: importEpubStrings.commit(2) }));
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(1));
    expect(within(sheet).getByTestId("import-error")).toHaveTextContent("disk_full");
    expect(within(getToastRegion()).getByText(importEpubStrings.importedPartly(1, 1))).toBeInTheDocument();
  });

  it("treats a file without an answer from the import as failed, with no success toast", async () => {
    const user = setupUser();
    const { api, drop, picked } = fakeApi();
    const onlyFirst = async (items: { id: string }[]): Promise<ImportResult[]> =>
      [{ id: items[0].id, key: `import:${items[0].id}`, outputDir: `/out/${items[0].id}`, error: null }];
    api.commit.mockImplementation(onlyFirst);
    await renderWith(api);
    await waitFor(() => expect(api.onDropped).toHaveBeenCalled());
    drop(picked.slice(0, 2));
    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(2));

    await user.click(within(sheet).getByRole("button", { name: importEpubStrings.commit(2) }));
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(1));
    expect(within(sheet).getByTestId("import-error")).toHaveTextContent(importEpubStrings.missingResult);
    expect(within(getToastRegion()).getByText(importEpubStrings.importedPartly(1, 1))).toBeInTheDocument();
    expect(within(getToastRegion()).queryByText(importEpubStrings.imported(2))).not.toBeInTheDocument();
  });

  it("does not let the volume block a file once its series is cleared", async () => {
    const user = setupUser();
    const { api, drop, picked } = fakeApi();
    await renderWith(api);
    await waitFor(() => expect(api.onDropped).toHaveBeenCalled());
    drop(picked.slice(1, 2));
    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(1));
    const row = rowOf("withCover.epub");
    const volume = within(row).getByLabelText(importEpubStrings.volumeLabel);
    await user.clear(volume);
    await user.type(volume, "dois");
    expect(within(sheet).getByRole("button", { name: importEpubStrings.commit(0) })).toBeDisabled();
    await user.clear(within(row).getByLabelText(importEpubStrings.seriesLabel));
    expect(within(row).queryByText(importEpubStrings.volumeInvalid)).not.toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: importEpubStrings.commit(1) }));
    await waitFor(() => expect(api.commit).toHaveBeenCalledWith([{ id: "withCover", title: "Second", author: "Autora B", series: null, coverPng: null }]));
  });

  it("puts the import next to refresh as an icon button, like the other toolbar icons", async () => {
    const user = setupUser();
    const { api } = fakeApi();
    await renderWith(api);
    await user.click(screen.getByRole("button", { name: navStrings.library }));
    const button = await screen.findByTestId("library-import");
    expect(button).toHaveAccessibleName(importEpubStrings.button);
    expect(button).toHaveAttribute("title", importEpubStrings.button);
    // Icon only: the name is the label and tooltip, no text on the button.
    expect(button.textContent).toBe("");
    expect(button.nextElementSibling).toBe(screen.getByRole("button", { name: libraryStrings.refresh }));
    await user.click(button);
    expect(api.pick).toHaveBeenCalledTimes(1);
  });

  it("covers the window with \"Solte para importar\" while EPUBs are dragged over it", async () => {
    const { api, drop, hover, picked } = fakeApi();
    await renderWith(api);
    await waitFor(() => expect(api.onDragHover).toHaveBeenCalled());
    expect(screen.queryByTestId("import-drop-overlay")).not.toBeInTheDocument();

    hover(true);
    expect(screen.getByTestId("import-drop-overlay")).toHaveTextContent(importEpubStrings.dropTitle);
    hover(false);
    expect(screen.queryByTestId("import-drop-overlay")).not.toBeInTheDocument();

    // Dropping hides it and opens the usual preview.
    hover(true);
    drop(picked.slice(2, 3));
    expect(screen.queryByTestId("import-drop-overlay")).not.toBeInTheDocument();
    expect(await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle })).toBeInTheDocument();
  });

  it("runs the import from the File menu on any page, opening the Library first", async () => {
    const { api, chooseMenu } = fakeApi();
    await renderWith(api);
    await waitFor(() => expect(api.onMenuImport).toHaveBeenCalled());
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.discover })).toBeInTheDocument();

    chooseMenu();
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.library })).toBeInTheDocument();
    await waitFor(() => expect(api.pick).toHaveBeenCalledTimes(1));
    const sheet = await screen.findByRole("dialog", { name: importEpubStrings.sheetTitle });
    await waitFor(() => expect(within(sheet).getAllByTestId("import-item")).toHaveLength(4));
  });

  it("imports with Ctrl+O where there is no menu bar, and leaves ⌘O to the Mac menu", async () => {
    const { api } = fakeApi();
    await renderWith(api);
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.library })).toBeInTheDocument();
    await waitFor(() => expect(api.pick).toHaveBeenCalledTimes(1));
  });

  it("does not handle Ctrl+O itself on the Mac (the File menu's ⌘O does)", async () => {
    document.documentElement.dataset.platform = "macos";
    try {
      const { api } = fakeApi();
      await renderWith(api);
      fireEvent.keyDown(window, { key: "o", ctrlKey: true });
      fireEvent.keyDown(window, { key: "o", metaKey: true });
      expect(api.pick).not.toHaveBeenCalled();
    } finally {
      delete document.documentElement.dataset.platform;
    }
  });

  it("offers the import in the empty library", async () => {
    const user = setupUser();
    const { api } = fakeApi();
    const empty: BackendClient = {
      ...mockBackendClient,
      async bootstrap() {
        return { ...(await mockBackendClient.bootstrap()), library: [] };
      }
    };
    await renderWith(api, empty);
    await user.click(await screen.findByRole("button", { name: navStrings.library }));
    expect(await screen.findByRole("heading", { name: libraryStrings.emptyTitle })).toBeInTheDocument();
    expect(screen.getByText(libraryStrings.emptyDescriptionImport)).toBeInTheDocument();
    await user.click(screen.getByTestId("library-empty-import"));
    expect(api.pick).toHaveBeenCalledTimes(1);
  });

  it("has no import button outside the desktop app", async () => {
    const user = setupUser();
    const { api } = fakeApi();
    await renderWith({ ...api, available: false });
    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: importEpubStrings.button })).not.toBeInTheDocument();
    expect(api.onDropped).not.toHaveBeenCalled();
    expect(api.onDragHover).not.toHaveBeenCalled();
    expect(api.onMenuImport).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "o", ctrlKey: true });
    expect(api.pick).not.toHaveBeenCalled();
  });
});
