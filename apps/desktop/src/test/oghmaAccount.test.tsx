import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { avatarColors, avatarUrl, characterAvatars, originalAvatars } from "../core/avatars";
import type { AccountClient, AccountUser, ApiResult } from "../services/accountClient";
import { mockBackendClient } from "../services/mockBackend";
import { oghmaAccountStrings as s } from "../strings/oghmaAccount";
import { localNicknameProblem } from "../features/account/ProfileEditor";
import { suggestEmailFix } from "../features/account/emailTypos";
import { createTestQueue, resetAppState, seedSetup, setupUser } from "./renderApp";

const invokeMock = vi.fn();
vi.mock("../services/localFiles", async (importOriginal) => {
  const original = await importOriginal<typeof import("../services/localFiles")>();
  return {
    ...original,
    librarySyncPending: (...args: unknown[]) => invokeMock("pending", ...args),
    librarySyncMarkClean: (...args: unknown[]) => invokeMock("markClean", ...args),
    librarySyncApply: (...args: unknown[]) => invokeMock("apply", ...args),
    librarySyncMarkAllDirty: (...args: unknown[]) => invokeMock("markAllDirty", ...args)
  };
});

import { syncLibrary } from "../services/librarySync";

// No Node typings in the app: read files through a runtime import of node:fs (as cssLayers.test does).
type Fs = { readFileSync(path: string, encoding: "utf8"): string };
const nodeFs = "node:fs";
let fs: Fs;
/** Absolute path of apps/desktop/ (this file is src/test/oghmaAccount.test.tsx). */
const appDir = decodeURIComponent(import.meta.url.replace(/^file:\/\//, "")).replace(/src\/test\/[^/]+$/, "");
const readFileSync = (path: string) => fs.readFileSync(appDir + path, "utf8");

beforeAll(async () => {
  fs = (await import(/* @vite-ignore */ nodeFs)) as Fs;
});

describe("avatars", () => {
  it("lists the same avatars and colors as the account API, and every image exists", () => {
    const backend = JSON.parse(readFileSync("../../backend/src/oghma/accounts/avatars.json")) as { ids: string[]; colors: string[] };
    const ids = [...characterAvatars.map((avatar) => avatar.id), ...originalAvatars.flatMap((arq) => arq.variants)];
    expect(backend.ids).toEqual(ids);
    expect(backend.colors).toEqual([...avatarColors]);
    for (const id of ids) {
      const image = readFileSync(`public${avatarUrl(id)}`);
      expect(image.slice(0, 4)).toBe("RIFF");
    }
  });

  it("checks nicknames with the server's rules", () => {
    expect(localNicknameProblem("ab")).toBe("nickname_too_short");
    expect(localNicknameProblem("a".repeat(21))).toBe("nickname_too_long");
    expect(localNicknameProblem("_jandson")).toBe("nickname_invalid_chars");
    expect(localNicknameProblem("jan..dson")).toBe("nickname_invalid_chars");
    expect(localNicknameProblem("João.leitor")).toBeNull();
  });
});

function fakeClient(overrides: Partial<AccountClient> = {}) {
  const calls: Array<[string, string, unknown]> = [];
  let profile: AccountUser = {
    publicId: "pub1",
    email: "leitor@example.com",
    nickname: null,
    avatarId: null,
    avatarColor: null,
    createdAt: "2026-10-04T00:00:00Z",
    needsProfile: true
  };
  const ok = <T,>(body: T, status = 200): ApiResult<T> => ({ status, body });
  const client: AccountClient & { calls: typeof calls } = {
    available: true,
    calls,
    status: vi.fn(async () => ({ signedIn: false })),
    requestCode: vi.fn(async (_base: string, email: string) => ok({ email, resendIn: 60, loginId: "login-1" }, 202)),
    poll: vi.fn(async () => ok({ status: "pending" }, 202)),
    verify: vi.fn(async (_base: string, _email: string, code: string) =>
      code === "123456" ? ok({ user: profile, created: true }) : ok({ error: "invalid_code", attemptsLeft: 4 }, 400)),
    api: vi.fn(async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body]);
      if (path.startsWith("/v1/nicknames/")) {
        const nickname = decodeURIComponent(path.split("/")[3]);
        return ok(nickname.toLowerCase() === "jandson"
          ? { available: false, reason: "taken", suggestions: ["jandson_br"] }
          : { available: true, reason: null, suggestions: [] });
      }
      if (method === "PATCH" && path === "/v1/me") {
        profile = { ...profile, ...(body as object), needsProfile: false };
        return ok(profile);
      }
      if (path === "/v1/me") return ok(profile);
      if (path.startsWith("/v1/me/library?")) return ok({ entries: [], cursor: 0, more: false });
      if (path === "/v1/me/library/changes") return ok({ accepted: [], rejected: [], cursor: 0 });
      if (path === "/v1/me/sessions") return ok({ sessions: [] });
      return ok({});
    }) as AccountClient["api"],
    logout: vi.fn(async () => undefined),
    forget: vi.fn(async () => undefined),
    ...overrides
  };
  return client;
}

describe("e-mail typos", () => {
  it("suggests the provider the reader meant, and leaves real domains alone", () => {
    expect(suggestEmailFix("jandson.macedo2301@gmail.con")).toBe("jandson.macedo2301@gmail.com");
    expect(suggestEmailFix("a@gmial.com")).toBe("a@gmail.com");
    expect(suggestEmailFix("a@hotmial.com")).toBe("a@hotmail.com");
    expect(suggestEmailFix("a@icloud.co")).toBe("a@icloud.com");
    expect(suggestEmailFix("a@uol.con.br")).toBe("a@uol.com.br");
    expect(suggestEmailFix("a@gmail.com")).toBeNull();
    expect(suggestEmailFix("a@oghma.dev")).toBeNull();
    expect(suggestEmailFix("a@empresa.co")).toBeNull();
    expect(suggestEmailFix("a@")).toBeNull();
  });
});

describe("library sync", () => {
  beforeEach(() => invokeMock.mockReset());

  it("pushes pending rows, marks the accepted ones clean and applies the pull in pages", async () => {
    const pending = [{ key: "novel:a", changedAt: 5 }, { key: "novel:b", changedAt: 6 }];
    invokeMock.mockImplementation(async (kind: string, rows?: { key: string }[]) => (kind === "pending" ? pending : kind === "apply" ? (rows ?? []).map((row) => row.key) : 0));
    const pages = [
      { entries: [{ key: "novel:c", changedAt: 9, seq: 3 }], cursor: 3, more: true },
      { entries: [{ key: "novel:d", changedAt: 9, deletedAt: 9, seq: 4 }], cursor: 4, more: false }
    ];
    const client = fakeClient({
      api: vi.fn(async (_method: string, path: string) => {
        if (path === "/v1/me/library/changes") return { status: 200, body: { accepted: [pending[0]], rejected: ["novel:b"], cursor: 2 } };
        return { status: 200, body: pages.shift() };
      }) as AccountClient["api"]
    });

    const result = await syncLibrary(client, 1, { joinAccount: true });
    expect(invokeMock).toHaveBeenCalledWith("markAllDirty");
    expect(invokeMock).toHaveBeenCalledWith("markClean", [pending[0]]);
    expect(client.api).toHaveBeenCalledWith("GET", "/v1/me/library?since=1");
    expect(client.api).toHaveBeenCalledWith("GET", "/v1/me/library?since=3");
    // `seq` is the server's; the local rows never get it.
    expect(invokeMock).toHaveBeenCalledWith("apply", [{ key: "novel:c", changedAt: 9 }]);
    // "d" came removed from another computer: the app is told, to warn if it is downloaded here.
    expect(result).toEqual({ cursor: 4, pushed: 1, applied: 2, removed: ["d"] });
  });

  it("stops on an expired session", async () => {
    invokeMock.mockResolvedValue([]);
    const client = fakeClient({ api: vi.fn(async () => ({ status: 401, body: { error: "unauthorized" } })) as AccountClient["api"] });
    await expect(syncLibrary(client, 0)).rejects.toThrow("unauthorized");
  });
});

describe("automatic sync", () => {
  beforeEach(() => {
    resetAppState();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (kind: string, rows?: { key: string }[]) => (kind === "pending" ? [] : kind === "apply" ? (rows ?? []).map((row) => row.key) : 0));
  });

  it("pulls on its own as soon as the server says another device changed the library", async () => {
    seedSetup();
    let announced = false;
    const pulls: string[] = [];
    const client = fakeClient({ status: vi.fn(async () => ({ signedIn: true, baseUrl: "https://conta.oghma.dev" })) });
    const user = { publicId: "pub1", email: "a@b.com", nickname: "leitor", avatarId: "rem", avatarColor: null, createdAt: "", needsProfile: false };
    client.api = vi.fn(async (_method: string, path: string) => {
      if (path === "/v1/me") return { status: 200, body: user };
      if (path.startsWith("/v1/me/library/wait")) {
        if (announced) return new Promise(() => undefined); // keeps waiting
        announced = true;
        return { status: 200, body: { changed: true, cursor: 7 } };
      }
      if (path.startsWith("/v1/me/library?")) {
        pulls.push(path);
        return { status: 200, body: { entries: pulls.length > 1 ? [{ key: "novel:cn:9", changedAt: 5, seq: 7 }] : [], cursor: 7, more: false } };
      }
      return { status: 200, body: {} };
    }) as AccountClient["api"];
    render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} accountClient={client} />);
    // Boot sync, then the pull the server's "changed" triggers, with no button anywhere.
    await waitFor(() => expect(pulls.length).toBeGreaterThanOrEqual(2), { timeout: 5000 });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("apply", [{ key: "novel:cn:9", changedAt: 5 }]));
    expect(screen.queryByRole("button", { name: s.syncNow })).not.toBeInTheDocument();
  }, 15000);
});

describe("pending changes", () => {
  beforeEach(() => {
    resetAppState();
    invokeMock.mockReset();
  });

  it("go up within a wait cycle even when nothing announced them (a finished download)", async () => {
    seedSetup();
    // The download marked the book in Rust: pending, and no JS event fired.
    let pending = [{ key: "novel:cn:7", changedAt: 50, onShelf: true }];
    invokeMock.mockImplementation(async (kind: string, rows?: unknown) => {
      if (kind === "pending") return pending;
      if (kind === "markClean") {
        pending = [];
        return 1;
      }
      return kind === "apply" ? [] : 0;
    });
    const pushes: unknown[] = [];
    const client = fakeClient({ status: vi.fn(async () => ({ signedIn: true, baseUrl: "https://conta.oghma.dev" })) });
    const user = { publicId: "pub1", email: "a@b.com", nickname: "leitor", avatarId: "rem", avatarColor: null, createdAt: "", needsProfile: false };
    let waits = 0;
    client.api = vi.fn(async (_method: string, path: string, body?: unknown) => {
      if (path === "/v1/me") return { status: 200, body: user };
      if (path.startsWith("/v1/me/library/wait")) {
        waits += 1;
        // The boot sync fails to push (offline for a moment); then the server says "nothing new".
        return waits > 2 ? new Promise(() => undefined) : { status: 200, body: { changed: false, cursor: 0 } };
      }
      if (path === "/v1/me/library/changes") {
        pushes.push(body);
        return pushes.length === 1 ? { status: 503, body: {} } : { status: 200, body: { accepted: [{ key: "novel:cn:7", changedAt: 50 }], rejected: [], cursor: 1 } };
      }
      if (path.startsWith("/v1/me/library?")) return { status: 200, body: { entries: [], cursor: 1, more: false } };
      return { status: 200, body: {} };
    }) as AccountClient["api"];
    render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} accountClient={client} />);
    await waitFor(() => expect(pushes.length).toBeGreaterThanOrEqual(2), { timeout: 8000 });
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("markClean", [{ key: "novel:cn:7", changedAt: 50 }]));
  }, 15000);
});

describe("account sign-in flow (e-mail button)", () => {
  beforeEach(() => {
    resetAppState();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (kind: string) => (kind === "pending" ? [] : 0));
  });

  it("finishes on its own once the button in the e-mail is confirmed", async () => {
    const user = setupUser();
    seedSetup();
    let confirmed = false;
    const client = fakeClient({ status: vi.fn(async () => ({ signedIn: false })) });
    client.poll = vi.fn(async (_base: string, _email: string, loginId: string) => {
      expect(loginId).toBe("login-1");
      return confirmed
        ? { status: 200, body: { user: { publicId: "p", email: "a@b.com", nickname: "leitor", avatarId: "cultivador", avatarColor: null, createdAt: "", needsProfile: false }, created: false } }
        : { status: 202, body: { status: "pending" } };
    });
    render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} accountClient={client} />);
    await user.click(await screen.findByTestId("sidebar-account-sign-in"));
    await user.type(await screen.findByLabelText(s.emailLabel), "a@b.com");
    await user.click(screen.getByTestId("account-continue"));
    expect(await screen.findByText(s.orTapButton)).toBeInTheDocument();

    confirmed = true;
    await waitFor(() => expect(screen.getByTestId("sidebar-account")).toHaveTextContent("leitor"), { timeout: 5000 });
    expect(screen.queryByRole("dialog", { name: s.codeTitle })).not.toBeInTheDocument();
  }, 15000);
});

describe("account sign-in flow", () => {
  beforeEach(() => {
    resetAppState();
    invokeMock.mockReset();
    invokeMock.mockImplementation(async (kind: string) => (kind === "pending" ? [] : 0));
  });

  it("signs in by code, creates the profile with a free nickname and shows it in the sidebar", async () => {
    const user = setupUser();
    seedSetup();
    const client = fakeClient();
    render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} accountClient={client} />);

    await user.click(await screen.findByTestId("sidebar-account-sign-in"));
    const sheet = await screen.findByRole("dialog", { name: s.emailTitle });
    await user.type(within(sheet).getByLabelText(s.emailLabel), "Leitor@Example.com");
    await user.click(within(sheet).getByTestId("account-continue"));

    const codeSheet = await screen.findByRole("dialog", { name: s.codeTitle });
    const digits = within(codeSheet).getAllByRole("textbox");
    expect(digits).toHaveLength(6);
    // A wrong code shakes the boxes and keeps the sheet open.
    await user.type(digits[0], "000000");
    expect(await within(codeSheet).findByRole("alert")).toHaveTextContent(s.errors.invalid_code);
    await user.click(within(codeSheet).getAllByRole("textbox")[0]);
    await user.paste("123456");

    const profile = await screen.findByRole("dialog", { name: s.profileTitle });
    // A random avatar is already picked (a character, or an original with its variant and color).
    expect(within(profile).getAllByRole("radio", { checked: true }).length).toBeGreaterThanOrEqual(1);
    const nickname = within(profile).getByLabelText(s.nicknameLabel);
    await user.type(nickname, "Jandson");
    expect(await within(profile).findByText(s.errors.nickname_taken)).toBeInTheDocument();
    expect(within(profile).getByTestId("account-save-profile")).toBeDisabled();
    await user.click(within(profile).getByRole("button", { name: "jandson_br" }));
    await waitFor(() => expect(within(profile).getByTestId("account-save-profile")).toBeEnabled(), { timeout: 3000 });
    await user.click(within(profile).getByTestId("account-save-profile"));

    await waitFor(() => expect(screen.getByTestId("sidebar-account")).toHaveTextContent("jandson_br"));
    const patch = client.calls.find(([method]) => method === "PATCH");
    expect(patch?.[2]).toMatchObject({ nickname: "jandson_br" });
    // Signing in joins this computer's library to the account.
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("markAllDirty"));
  }, 15000);
});
