import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import type { LibraryItem } from "../../core/types";
import type { AccountClient } from "../../services/accountClient";
import type { BackendClient } from "../../services/backendClient";
import type { ImportApi, PickedFile, UploadResult } from "../../services/importClient";
import { mockBackendClient } from "../../services/mockBackend";
import { accountFilesStrings as s } from "../../strings/accountFiles";
import { navStrings } from "../../strings/common";
import { importEpubStrings } from "../../strings/importEpub";
import { libraryStrings } from "../../strings/library";
import { settingsStrings } from "../../strings/settings";
import { createTestQueue, defaultBookTitle, findBookCardTitle, resetAppState, seedSetup, setupUser, type TestUser } from "../renderApp";

// The account sync itself is covered elsewhere: here it only has to finish.
vi.mock("../../services/librarySync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/librarySync")>()),
  syncLibrary: vi.fn(async () => ({ cursor: 1, pushed: 0, applied: 0, removed: [] }))
}));

const key = (id: string) => `import:${id.padEnd(64, "0")}`;

function imported(id: string, title: string, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: `local-${id}`,
    novelId: key(id),
    title,
    author: "",
    format: "EPUB",
    formats: ["EPUB"],
    chapters: 0,
    sizeMb: 2,
    coverClass: "cover-c",
    outputDir: `/out/${title}`,
    files: [`${title}.epub`],
    exportedAt: "Hoje, 10:00",
    private: true,
    ...overrides
  };
}

const here = imported("cs", "Caged Sparrow");
const inAccount = imported("bw", "Broken Wings", { id: `shelf-${key("bw")}`, availability: "shelf", formats: [], files: [], outputDir: undefined });

const createDownloads = vi.fn(mockBackendClient.createDownloads.bind(mockBackendClient));
const backend: BackendClient = {
  ...mockBackendClient,
  createDownloads,
  async bootstrap() {
    const payload = await mockBackendClient.bootstrap();
    return { ...payload, library: [...payload.library, here, inAccount] };
  }
};

function fakeApi(upload: (key: string) => Promise<UploadResult>) {
  const picked: PickedFile[] = [{ id: "new", fileName: "Unsheathed - Volume 3 - Fallen Star.epub", size: 10 }];
  return {
    available: true,
    pick: vi.fn(async () => picked),
    preview: vi.fn(async () => [{
      id: "new", fileName: picked[0].fileName, sha256: "n".repeat(64), size: 10, title: "Fallen Star", author: "Autor", language: null,
      series: null, seriesSource: null, coverDataUrl: "data:image/png;base64,AAAA", coverFromLibrary: null, alreadyImported: null, error: null
    }]),
    commit: vi.fn(async () => [{ id: "new", key: key("new"), outputDir: "/out/Fallen Star", error: null }]),
    upload: vi.fn(upload),
    download: vi.fn(async (k: string) => ({ key: k, outputDir: "/out/Broken Wings", error: null })),
    usage: vi.fn(async () => ({ usedBytes: 1_887_437, quotaBytes: 2048 * 1024 * 1024, files: 1 })),
    onDropped: vi.fn(async () => () => undefined),
    onDragHover: vi.fn(async () => () => undefined),
    onMenuImport: vi.fn(async () => () => undefined),
    onFileProgress: vi.fn(async () => () => undefined)
  } satisfies ImportApi;
}

function signedInClient(): AccountClient {
  const user = { publicId: "pub1", email: "a@b.com", nickname: "leitor", avatarId: "rem", avatarColor: null, createdAt: "", needsProfile: false };
  return {
    available: true,
    status: vi.fn(async () => ({ signedIn: true, baseUrl: "https://conta.oghma.dev" })),
    requestCode: vi.fn(),
    poll: vi.fn(),
    verify: vi.fn(),
    api: vi.fn(async (_method: string, path: string) => {
      if (path === "/v1/me") return { status: 200, body: user };
      if (path.includes("/wait")) return new Promise(() => undefined);
      if (path === "/v1/me/sessions") return { status: 200, body: { sessions: [] } };
      return { status: 200, body: {} };
    }) as AccountClient["api"],
    logout: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined)
  };
}

async function openLibrary(user: TestUser, api: ImportApi, accountClient?: AccountClient) {
  seedSetup();
  render(<App backend={backend} downloadQueue={createTestQueue()} importApi={api} accountClient={accountClient} />);
  await findBookCardTitle(defaultBookTitle);
  await user.click(screen.getByRole("button", { name: navStrings.library }));
  await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(2));
}

const cardOf = (title: string) =>
  screen.getAllByTestId("library-card").find((card) => within(card).queryByRole("button", { name: libraryStrings.openDetailsOf(title) }))!;

describe("Imported books and the account", () => {
  beforeEach(() => {
    resetAppState();
    createDownloads.mockClear();
  });

  it("signed out: the book here is only on this computer; the one in the account downloads from it", async () => {
    const user = setupUser();
    const api = fakeApi(async (k) => ({ key: k, state: "uploaded", error: null }));
    await openLibrary(user, api);

    expect(within(cardOf(here.title)).getByTestId("library-account-badge")).toHaveTextContent(s.localOnly);
    expect(within(cardOf(inAccount.title)).getByTestId("library-shelf-badge")).toHaveTextContent(s.inAccount);
    expect(api.upload).not.toHaveBeenCalled();

    // "Baixar novamente" is a catalog download: imported books do not offer it.
    await user.click(within(cardOf(here.title)).getByRole("button", { name: libraryStrings.cardActions(here.title) }));
    expect(screen.queryByRole("menuitem", { name: libraryStrings.downloadAgain })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.click(within(cardOf(inAccount.title)).getByRole("button", { name: libraryStrings.openDetailsOf(inAccount.title) }));
    const detail = await screen.findByTestId("library-detail");
    await user.click(within(detail).getByRole("button", { name: s.download }));
    await waitFor(() => expect(api.download).toHaveBeenCalledWith(key("bw"), "Broken Wings"));
    expect(createDownloads).not.toHaveBeenCalled();
    expect(await screen.findByText(s.downloaded("Broken Wings"))).toBeInTheDocument();
  });

  it("signed in: sends the books here after the sync, retries a failure and shows the quota in Ajustes", async () => {
    const user = setupUser();
    let refuse = true;
    const api = fakeApi(async (k) => (refuse ? { key: k, state: "failed", error: "network" } : { key: k, state: "uploaded", error: null }));
    await openLibrary(user, api, signedInClient());

    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(key("cs")));
    // Only the book with a folder here goes up; the one in the account is already there.
    expect(api.upload).not.toHaveBeenCalledWith(key("bw"));
    const badge = await within(cardOf(here.title)).findByText(s.notSent);
    refuse = false;
    await user.click(within(badge.closest("[data-testid='library-account-badge']") as HTMLElement).getByRole("button", { name: s.retryLabel(here.title) }));
    await waitFor(() => expect(within(cardOf(here.title)).getByTestId("library-account-badge")).toHaveTextContent(s.inAccount));
    // The retry did not open the book.
    expect(screen.queryByTestId("library-detail")).not.toBeInTheDocument();

    // Signed in, Ajustes lives in the account menu of the sidebar.
    await user.click(screen.getByTestId("account-button"));
    await user.click(screen.getByRole("menuitem", { name: /^Ajustes/ }));
    await screen.findByTestId("settings-page");
    await user.click(screen.getByRole("tab", { name: settingsStrings.categories.account }));
    expect(await screen.findByRole("progressbar", { name: s.usageSummary("1,8 MB", "2,0 GB") })).toBeInTheDocument();
    expect(screen.getByText(s.usageLabel)).toBeInTheDocument();
    expect(screen.getByText(`${s.usageValue("1,8 MB", "2,0 GB")} · ${s.usageFiles(1)}`)).toBeInTheDocument();
  });

  it("signed in: a new import goes up to the account in the background", async () => {
    const user = setupUser();
    const api = fakeApi(async (k) => ({ key: k, state: "uploaded", error: null }));
    await openLibrary(user, api, signedInClient());
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(key("cs")));

    await user.click(screen.getByRole("button", { name: importEpubStrings.button }));
    await user.click(await screen.findByRole("button", { name: importEpubStrings.commit(1) }));
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(key("new")));
  });
});
