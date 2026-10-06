import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AccountClient, AccountUser } from "../services/accountClient";
import { useSocial } from "../features/social/useSocial";

const me: AccountUser = { publicId: "me", email: "a@b.com", nickname: "leitor", avatarId: null, avatarColor: null, createdAt: "", needsProfile: false };
const ana = { publicId: "ana", nickname: "ana", avatarId: null, avatarColor: null };

function client(routes: Record<string, (body?: unknown) => { status: number; body: unknown }>): AccountClient {
  return {
    available: true,
    status: vi.fn(async () => ({ signedIn: true })),
    requestCode: vi.fn(),
    poll: vi.fn(),
    verify: vi.fn(),
    logout: vi.fn(),
    forget: vi.fn(),
    api: vi.fn(async (method: string, path: string, body?: unknown) => {
      const key = `${method} ${path.split("?")[0]}`;
      const route = routes[key];
      return route ? route(body) : { status: 404, body: { error: "not_found" } };
    })
  } as unknown as AccountClient;
}

describe("useSocial", () => {
  it("is unavailable on a server without the social side", async () => {
    const api = client({});
    const { result } = renderHook(() => useSocial({ client: api, signedIn: true, me }));
    await waitFor(() => expect(result.current.support).toBe("no"));
    expect(result.current.available).toBe(false);
  });

  it("loads friends, conversations and recommendations, and counts what needs attention", async () => {
    const routes = {
      "GET /v1/friends": () => ({ status: 200, body: { friends: [{ ...ana, since: "2026-10-01T00:00:00Z" }], incoming: [{ ...ana, publicId: "bia", nickname: "bia", requestedAt: "" }], outgoing: [] } }),
      "GET /v1/conversations": () => ({ status: 200, body: [{ friend: ana, last: { id: 1, from: "ana", to: "me", body: "oi", createdAt: "" }, unread: 2 }] }),
      "GET /v1/recommendations": () => ({ status: 200, body: [
        { id: 3, from: "ana", to: "me", body: "", novelId: "cn:x", noteStatus: "new", createdAt: "", fromUser: ana },
        { id: 4, from: "ana", to: "me", body: "", novelId: "cn:y", noteStatus: "added", createdAt: "", fromUser: ana }
      ] }),
      "GET /v1/feed": () => ({ status: 200, body: { items: [], more: false } })
    };
    const api = client(routes);
    const { result } = renderHook(() => useSocial({ client: api, signedIn: true, me }));
    await waitFor(() => expect(result.current.available).toBe(true));
    expect(result.current.unreadMessages).toBe(2);
    expect(result.current.newRecommendations).toBe(1);
    // 2 unread + 1 request + 1 new recommendation.
    expect(result.current.attention).toBe(4);
    expect(result.current.friendById("ana")?.nickname).toBe("ana");
  });

  it("reloads the lists after an action and when told something changed", async () => {
    let friends = 0;
    const routes = {
      "GET /v1/friends": () => {
        friends += 1;
        return { status: 200, body: { friends: [], incoming: [], outgoing: [] } };
      },
      "GET /v1/conversations": () => ({ status: 200, body: [] }),
      "GET /v1/recommendations": () => ({ status: 200, body: [] }),
      "GET /v1/feed": () => ({ status: 200, body: { items: [], more: false } }),
      "POST /v1/friends/requests": (body?: unknown) => ({ status: 200, body: { status: (body as { nickname: string }).nickname === "ana" ? "pending" : "x" } })
    };
    const api = client(routes);
    const { result } = renderHook(() => useSocial({ client: api, signedIn: true, me }));
    await waitFor(() => expect(result.current.available).toBe(true));
    const before = friends;
    let sent: Awaited<ReturnType<typeof result.current.requestFriend>> | undefined;
    await act(async () => {
      sent = await result.current.requestFriend("@ana");
    });
    expect(sent).toEqual({ ok: true, value: { status: "pending" } });
    await waitFor(() => expect(friends).toBeGreaterThan(before));
    const afterAction = friends;
    await act(async () => {
      await result.current.refresh();
    });
    expect(friends).toBeGreaterThan(afterAction);
  });

  it("clears everything when signed out", async () => {
    const routes = {
      "GET /v1/friends": () => ({ status: 200, body: { friends: [{ ...ana, since: "" }], incoming: [], outgoing: [] } }),
      "GET /v1/conversations": () => ({ status: 200, body: [] }),
      "GET /v1/recommendations": () => ({ status: 200, body: [] }),
      "GET /v1/feed": () => ({ status: 200, body: { items: [], more: false } })
    };
    const api = client(routes);
    const { result, rerender } = renderHook(({ signedIn }) => useSocial({ client: api, signedIn, me: signedIn ? me : null }), { initialProps: { signedIn: true } });
    await waitFor(() => expect(result.current.friends.friends).toHaveLength(1));
    rerender({ signedIn: false });
    await waitFor(() => expect(result.current.friends.friends).toHaveLength(0));
    expect(result.current.available).toBe(false);
  });
});

describe("readingNow (Início › Amigos estão lendo)", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 5, 12, minutes)).toISOString();
  const bia = { publicId: "bia", nickname: "bia", avatarId: null, avatarColor: null };
  it("keeps a book while the friend's latest event on it is a start, and groups readers", async () => {
    const { readingNow } = await import("../features/home/HomeView");
    const books = readingNow([
      { id: 1, user: ana, kind: "started", novelId: "x", snapshot: { novelId: "x", title: "X" }, at: at(1) },
      { id: 2, user: bia, kind: "started", novelId: "x", snapshot: { novelId: "x", title: "X" }, at: at(5) },
      { id: 3, user: ana, kind: "started", novelId: "y", snapshot: { novelId: "y", title: "Y" }, at: at(2) },
      { id: 4, user: ana, kind: "finished", novelId: "y", snapshot: { novelId: "y", title: "Y" }, at: at(9) }
    ]);
    expect(books.map((book) => book.novelId)).toEqual(["x"]);
    expect(books[0].readers.map((reader) => reader.nickname).sort()).toEqual(["ana", "bia"]);
  });
});
