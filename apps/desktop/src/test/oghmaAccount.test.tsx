import { render, screen, waitFor, within } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { avatarColors, avatarIds } from "../core/avatars";
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
  it("lists the same avatars and colors as the account API", () => {
    const python = readFileSync("../../backend/src/oghma/accounts/profile.py");
    const tuple = (name: string) => [...python.split(`${name}: tuple[str, ...] = (`)[1].split(")")[0].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(tuple("AVATAR_IDS")).toEqual([...avatarIds]);
    expect(tuple("AVATAR_COLORS")).toEqual([...avatarColors]);
    for (const id of avatarIds) {
      const svg = readFileSync(`public/avatars/${id}.svg`);
      expect(svg).toContain("<svg");
      expect(svg).not.toMatch(/gradient|<script|href=/i);
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
    invokeMock.mockImplementation(async (kind: string) => (kind === "pending" ? pending : kind === "apply" ? 1 : 0));
    const pages = [
      { entries: [{ key: "novel:c", changedAt: 9, seq: 3 }], cursor: 3, more: true },
      { entries: [{ key: "novel:d", changedAt: 9, seq: 4 }], cursor: 4, more: false }
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
    expect(result).toEqual({ cursor: 4, pushed: 1, applied: 2 });
  });

  it("stops on an expired session", async () => {
    invokeMock.mockResolvedValue([]);
    const client = fakeClient({ api: vi.fn(async () => ({ status: 401, body: { error: "unauthorized" } })) as AccountClient["api"] });
    await expect(syncLibrary(client, 0)).rejects.toThrow("unauthorized");
  });
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
    // A random avatar is already picked.
    expect(within(profile).getAllByRole("radio", { checked: true })).toHaveLength(2);
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
