import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildLibraryItems } from "../app/useLocalLibrary";
import type { LibraryItem, LibraryMeta } from "../core/types";
import { accountBadgeState } from "../features/library/AccountFileBadge";
import { useAccountFiles } from "../features/library/useAccountFiles";
import type { AccountFileProgress, DownloadResult, ImportApi, UploadResult } from "../services/importClient";
import type { LocalLibraryEntry } from "../services/localFiles";
import { accountFilesStrings } from "../strings/accountFiles";

const key = (id: string) => `import:${id.padEnd(64, "0")}`;

function book(id: string, overrides: Partial<LibraryItem> = {}): LibraryItem {
  return {
    id: `local-${id}`,
    novelId: key(id),
    title: `Livro ${id}`,
    author: "",
    format: "EPUB",
    formats: ["EPUB"],
    chapters: 0,
    sizeMb: 2,
    coverClass: "cover-c",
    outputDir: `/out/${id}`,
    exportedAt: "Local",
    availability: "local",
    ...overrides
  };
}

const catalogBook = book("cat", { novelId: "cn:1", id: "local-cat" });
const shelfVolume = book("shelf", { availability: "shelf", outputDir: undefined, formats: [] });

function fakeApi(upload: (key: string) => Promise<UploadResult> = async (k) => ({ key: k, state: "uploaded", error: null })) {
  let progress: ((value: AccountFileProgress) => void) | null = null;
  const api = {
    available: true,
    pick: vi.fn(),
    preview: vi.fn(),
    commit: vi.fn(),
    upload: vi.fn(upload),
    download: vi.fn(async (k: string): Promise<DownloadResult> => ({ key: k, outputDir: "/out/shelf", error: null })),
    usage: vi.fn(async () => ({ usedBytes: 1, quotaBytes: 2, files: 1 })),
    onDropped: vi.fn(async () => () => undefined),
    onFileProgress: vi.fn(async (handler: (value: AccountFileProgress) => void) => {
      progress = handler;
      return () => undefined;
    })
  } satisfies ImportApi;
  return { api, progress: (value: AccountFileProgress) => progress?.(value) };
}

type HookProps = { signedIn: boolean; lastSyncAt: number | null; library: LibraryItem[] };

function setup(api: ImportApi, initial: HookProps) {
  const notify = vi.fn();
  const refreshLibrary = vi.fn();
  const hook = renderHook((props: HookProps) => useAccountFiles({ ...props, refreshLibrary, notify, api }), { initialProps: initial });
  return { ...hook, notify, refreshLibrary };
}

describe("useAccountFiles", () => {
  it("sends imported books one at a time and shows sending, then in the account or failed", async () => {
    const gates: Array<() => void> = [];
    const { api } = fakeApi((k) => new Promise((resolve) => gates.push(() => resolve(
      k === key("b") ? { key: k, state: "failed", error: "quota_exceeded" } : { key: k, state: "uploaded", error: null }
    ))));
    const a = book("a");
    const b = book("b");
    const { result } = setup(api, { signedIn: true, lastSyncAt: null, library: [a, b] });

    act(() => result.current.upload([a.novelId!, b.novelId!]));
    await waitFor(() => expect(result.current.stateOf(a)?.phase).toBe("sending"));
    // One at a time: the second waits for the first.
    expect(result.current.stateOf(b)?.phase).toBe("queued");
    expect(api.upload).toHaveBeenCalledTimes(1);
    await act(async () => gates.shift()!());
    await waitFor(() => expect(api.upload).toHaveBeenCalledWith(b.novelId));
    expect(result.current.stateOf(a)?.phase).toBe("uploaded");
    await act(async () => gates.shift()!());
    await waitFor(() => expect(result.current.stateOf(b)).toEqual({ phase: "failed", error: "quota_exceeded" }));
    // Catalog books have no account state.
    expect(result.current.stateOf(catalogBook)).toBeNull();
  });

  it("does nothing signed out: imported books are only on this computer", () => {
    const { api } = fakeApi();
    const a = book("a");
    const { result } = setup(api, { signedIn: false, lastSyncAt: null, library: [a] });
    act(() => result.current.upload([a.novelId!]));
    expect(api.upload).not.toHaveBeenCalled();
    expect(result.current.stateOf(a)).toEqual({ phase: "local" });
    expect(result.current.stateOf(shelfVolume)).toBeNull();
  });

  it("drops an upload of the account that signed out: no false \"Na conta\" and the next account sends it again", async () => {
    const gates: Array<(result: UploadResult) => void> = [];
    const { api } = fakeApi(() => new Promise((resolve) => gates.push(resolve)));
    const a = book("a");
    const b = book("b");
    const { result, rerender } = setup(api, { signedIn: true, lastSyncAt: null, library: [a, b] });

    act(() => result.current.upload([a.novelId!, b.novelId!]));
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(1));
    // Signs out mid-upload; another account signs in before its sync finishes.
    rerender({ signedIn: false, lastSyncAt: null, library: [a, b] });
    rerender({ signedIn: true, lastSyncAt: null, library: [a, b] });
    await act(async () => gates.shift()!({ key: a.novelId!, state: "uploaded", error: null }));
    expect(result.current.stateOf(a)?.phase).not.toBe("uploaded");
    // The queued one of the old session never ran.
    expect(api.upload).toHaveBeenCalledTimes(1);

    rerender({ signedIn: true, lastSyncAt: 1, library: [a, b] });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    expect(api.upload).toHaveBeenLastCalledWith(a.novelId);
    expect(result.current.stateOf(a)?.phase).toBe("sending");
    expect(result.current.stateOf(b)?.phase).toBe("queued");
  });

  it("after each sync sends the local imports not in the account yet, retrying passing failures only", async () => {
    const failures: Record<string, string> = { [key("big")]: "file_too_large", [key("net")]: "network" };
    const { api } = fakeApi(async (k) => (failures[k] ? { key: k, state: "failed", error: failures[k] } : { key: k, state: "already", error: null }));
    const library = [book("a"), book("big"), book("net"), shelfVolume, catalogBook];
    const { result, rerender } = setup(api, { signedIn: true, lastSyncAt: null, library });
    expect(api.upload).not.toHaveBeenCalled();

    rerender({ signedIn: true, lastSyncAt: 1, library });
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(3));
    expect(api.upload.mock.calls.map(([k]) => k)).toEqual([key("a"), key("big"), key("net")]);
    await waitFor(() => expect(result.current.stateOf(library[2])?.phase).toBe("failed"));
    // "already" counts as in the account.
    expect(result.current.stateOf(library[0])?.phase).toBe("uploaded");

    delete failures[key("net")];
    rerender({ signedIn: true, lastSyncAt: 2, library });
    await waitFor(() => expect(result.current.stateOf(library[2])?.phase).toBe("uploaded"));
    // Only the network failure went again: too large stays failed until the reader retries.
    expect(api.upload.mock.calls.map(([k]) => k).slice(3)).toEqual([key("net")]);
    expect(result.current.stateOf(library[1])?.phase).toBe("failed");
  });

  it("retries on request and says why it failed again", async () => {
    const { api } = fakeApi(async (k) => ({ key: k, state: "failed", error: "quota_exceeded" }));
    const a = book("a");
    const { result, notify } = setup(api, { signedIn: true, lastSyncAt: null, library: [a] });
    act(() => result.current.upload([a.novelId!]));
    await waitFor(() => expect(result.current.stateOf(a)?.phase).toBe("failed"));
    expect(notify).not.toHaveBeenCalled();
    act(() => result.current.retry([a, catalogBook]));
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(notify).toHaveBeenCalledWith(accountFilesStrings.failedUpload(a.title, accountFilesStrings.errors.quota_exceeded), "warning"));
  });

  it("shows the upload progress from account-file-progress", async () => {
    let finish: () => void = () => undefined;
    const { api, progress } = fakeApi((k) => new Promise((resolve) => {
      finish = () => resolve({ key: k, state: "uploaded", error: null });
    }));
    const a = book("a");
    const { result } = setup(api, { signedIn: true, lastSyncAt: null, library: [a] });
    await waitFor(() => expect(api.onFileProgress).toHaveBeenCalled());
    act(() => result.current.upload([a.novelId!]));
    await waitFor(() => expect(result.current.stateOf(a)?.phase).toBe("sending"));
    act(() => progress({ key: a.novelId!, sent: 50, total: 200 }));
    expect(result.current.stateOf(a)).toEqual({ phase: "sending", percent: 25 });
    await act(async () => finish());
  });

  it("downloads a row without a folder from the account (never the catalog) and rescans", async () => {
    const { api } = fakeApi();
    const { result, notify, refreshLibrary } = setup(api, { signedIn: true, lastSyncAt: null, library: [shelfVolume] });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.download(shelfVolume);
    });
    expect(result.current.stateOf(shelfVolume)?.phase).toBe("downloading");
    await act(async () => pending);
    expect(api.download).toHaveBeenCalledWith(shelfVolume.novelId, shelfVolume.title);
    expect(refreshLibrary).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(accountFilesStrings.downloaded(shelfVolume.title), "success");
  });

  it("reports a refused download (sha_mismatch) and keeps the book on the shelf", async () => {
    const { api } = fakeApi();
    api.download.mockResolvedValueOnce({ key: shelfVolume.novelId!, outputDir: null, error: "sha_mismatch" });
    const { result, notify, refreshLibrary } = setup(api, { signedIn: true, lastSyncAt: null, library: [shelfVolume] });
    await act(async () => result.current.download(shelfVolume));
    expect(notify).toHaveBeenCalledWith(accountFilesStrings.failedDownload(shelfVolume.title, accountFilesStrings.errors.sha_mismatch), "danger");
    expect(refreshLibrary).not.toHaveBeenCalled();
    expect(result.current.stateOf(shelfVolume)).toBeNull();
  });
});

describe("accountBadgeState", () => {
  const states: Record<string, ReturnType<typeof accountBadgeState>> = {};
  const stateOf = (item: LibraryItem) => states[item.id] ?? null;

  it("sums up a series: sending, then failed, then in the account when every volume is there", () => {
    const v1 = book("v1");
    const v2 = book("v2");
    states[v1.id] = { phase: "uploaded" };
    expect(accountBadgeState([v1, v2, shelfVolume], stateOf)).toBeNull();
    states[v2.id] = { phase: "sending", percent: 40 };
    expect(accountBadgeState([v1, v2], stateOf)).toEqual({ phase: "sending", percent: 40 });
    states[v2.id] = { phase: "failed", error: "network" };
    expect(accountBadgeState([v1, v2], stateOf)?.phase).toBe("failed");
    states[v2.id] = { phase: "uploaded" };
    expect(accountBadgeState([v1, v2, shelfVolume], stateOf)).toEqual({ phase: "uploaded" });
    states[shelfVolume.id] = { phase: "downloading", percent: null };
    expect(accountBadgeState([v1, v2, shelfVolume], stateOf)?.phase).toBe("downloading");
    expect(accountBadgeState([catalogBook], stateOf)).toBeNull();
  });
});

describe("import: rows without a folder", () => {
  const sha = key("cs");
  const row: LibraryMeta = {
    key: sha,
    favorite: false,
    readingStatus: "unread",
    tags: [],
    hidden: false,
    onShelf: true,
    private: true,
    addedAt: 10,
    snapshot: { novelId: sha, title: "Caged Sparrow", author: "Autor", origin: "import", series: { id: "series:unsheathed", name: "Unsheathed", volume: 1 } }
  };

  it("become shelf books from the snapshot (kept in the account, not a source that left)", () => {
    const [item] = buildLibraryItems([], [row], []);
    expect(item).toMatchObject({
      id: `shelf-${sha}`,
      novelId: sha,
      title: "Caged Sparrow",
      author: "Autor",
      availability: "shelf",
      unavailable: false,
      series: { id: "series:unsheathed", name: "Unsheathed", volume: 1 }
    });
  });

  it("stay one book once the folder is on this computer", () => {
    const entry: LocalLibraryEntry = { title: "Caged Sparrow", folderName: "Caged Sparrow", outputDir: "/out/cs", files: ["Caged Sparrow.epub"], sizeBytes: 1, novelId: sha };
    const items = buildLibraryItems([entry], [row], []);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ availability: "local", novelId: sha });
  });
});
