// The social side of the Oghma account (friends, conversations, recommendations, friends'
// activity), over the same Rust proxy as the library sync (`AccountClient.api`, token in Rust).
// Shapes follow the server contract in the plan (`/v1/friends`, `/v1/conversations`, …).
import type { BookSnapshot, LibraryReadingStatus } from "../core/types";
import { errorCode, isOk, type AccountClient, type ApiResult } from "./accountClient";

export type UserCard = {
  publicId: string;
  nickname: string;
  avatarId: string | null;
  avatarColor: string | null;
};

export type Friend = UserCard & { since: string };
export type FriendRequest = UserCard & { requestedAt: string };
export type FriendsList = { friends: Friend[]; incoming: FriendRequest[]; outgoing: FriendRequest[] };

export type NoteStatus = "new" | "added" | "dismissed";

export type Message = {
  id: number;
  /** publicId of the sender and of the recipient. */
  from: string;
  to: string;
  body: string;
  novelId?: string | null;
  snapshot?: BookSnapshot | null;
  /** Only on messages carrying a book (a recommendation). */
  noteStatus?: NoteStatus | null;
  createdAt: string;
  readAt?: string | null;
};

export type Conversation = { friend: UserCard; last: Message; unread: number };
export type Recommendation = Message & { fromUser: UserCard };

export type FriendLibraryEntry = {
  novelId: string;
  favorite: boolean;
  readingStatus: LibraryReadingStatus;
  rating: number | null;
  addedAt: number | null;
  changedAt: number;
  snapshot: BookSnapshot | null;
};
export type FriendLibrary = { hidden: boolean; entries: FriendLibraryEntry[] };

export type ActivityKind = "started" | "finished" | "dropped" | "rated" | "added";
export type ActivityItem = {
  id: number;
  user: UserCard;
  kind: ActivityKind;
  novelId: string;
  snapshot: BookSnapshot | null;
  rating?: number | null;
  at: string;
};

/** `{ ok: true, value }` or `{ ok: false, error: "<api code>" | "network" }`. */
export type SocialResult<T> = { ok: true; value: T } | { ok: false; error: string };

async function request<T>(
  client: AccountClient,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<SocialResult<T>> {
  let result: ApiResult<T>;
  try {
    result = await client.api<T>(method, path, body);
  } catch {
    return { ok: false, error: "network" };
  }
  if (isOk(result)) return { ok: true, value: result.body };
  return { ok: false, error: result.status === 404 && path === "/v1/friends" ? "unsupported" : errorCode(result) };
}

const enc = encodeURIComponent;

export function socialApi(client: AccountClient) {
  return {
    /** Friends and pending requests. `unsupported` when the server has no social side yet. */
    friends: () => request<FriendsList>(client, "GET", "/v1/friends"),
    /** The card of the reader with exactly this nickname (no partial search). */
    lookup: (nickname: string) => request<UserCard>(client, "GET", `/v1/users/${enc(nickname.trim().replace(/^@/, ""))}`),
    requestFriend: (nickname: string) =>
      request<{ status: "pending" | "accepted" }>(client, "POST", "/v1/friends/requests", { nickname: nickname.trim().replace(/^@/, "") }),
    accept: (publicId: string) => request<{ status: "accepted" }>(client, "POST", `/v1/friends/${enc(publicId)}/accept`),
    /** Declines, cancels or ends a friendship. */
    remove: (publicId: string) => request<unknown>(client, "DELETE", `/v1/friends/${enc(publicId)}`),
    blocks: () => request<UserCard[]>(client, "GET", "/v1/blocks"),
    block: (publicId: string) => request<unknown>(client, "POST", `/v1/blocks/${enc(publicId)}`),
    unblock: (publicId: string) => request<unknown>(client, "DELETE", `/v1/blocks/${enc(publicId)}`),
    library: (publicId: string) => request<FriendLibrary>(client, "GET", `/v1/friends/${enc(publicId)}/library`),
    conversations: () => request<Conversation[]>(client, "GET", "/v1/conversations"),
    messages: (publicId: string, before?: number) =>
      request<{ messages: Message[]; more: boolean }>(
        client,
        "GET",
        `/v1/conversations/${enc(publicId)}/messages?limit=50${before ? `&before=${before}` : ""}`
      ),
    send: (publicId: string, message: { body?: string; novelId?: string; snapshot?: BookSnapshot }) =>
      request<Message>(client, "POST", `/v1/conversations/${enc(publicId)}/messages`, message),
    markRead: (publicId: string) => request<{ unread: number }>(client, "POST", `/v1/conversations/${enc(publicId)}/read`),
    recommendations: (status: "new" | "all" = "all") => request<Recommendation[]>(client, "GET", `/v1/recommendations?status=${status}`),
    setNoteStatus: (id: number, noteStatus: Exclude<NoteStatus, "new">) =>
      request<Message>(client, "PATCH", `/v1/messages/${id}`, { noteStatus }),
    feed: (before?: number) =>
      request<{ items: ActivityItem[]; more: boolean }>(client, "GET", `/v1/feed?limit=30${before ? `&before=${before}` : ""}`),
    privacy: (patch: { libraryVisible?: boolean; activityVisible?: boolean }) => request<unknown>(client, "PATCH", "/v1/me", patch)
  };
}

export type SocialApi = ReturnType<typeof socialApi>;
