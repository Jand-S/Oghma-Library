import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { ImportApi, ImportPreview, ImportResult, PickedFile } from "../../services/importClient";
import { mockBackendClient } from "../../services/mockBackend";
import { navStrings } from "../../strings/common";
import { importEpubStrings } from "../../strings/importEpub";
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
    onFileProgress: vi.fn(async () => () => undefined)
  } satisfies ImportApi;
  return { api, drop: (files: PickedFile[]) => dropped?.(files), picked };
}

async function renderWith(api: ImportApi) {
  seedSetup();
  render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} importApi={api} />);
  await findBookCardTitle(defaultBookTitle);
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

  it("has no import button outside the desktop app", async () => {
    const user = setupUser();
    const { api } = fakeApi();
    await renderWith({ ...api, available: false });
    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: importEpubStrings.button })).not.toBeInTheDocument();
    expect(api.onDropped).not.toHaveBeenCalled();
  });
});
