import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AccountClient, AccountUser } from "../../services/accountClient";
import {
  socialApi,
  type ActivityItem,
  type Conversation,
  type Friend,
  type FriendsList,
  type Recommendation,
  type SocialResult
} from "../../services/socialClient";

/** "unknown" until the first answer; "no" when the server has no social side yet. */
export type SocialSupport = "unknown" | "yes" | "no";

const EMPTY_FRIENDS: FriendsList = { friends: [], incoming: [], outgoing: [] };

type Options = {
  client: AccountClient;
  signedIn: boolean;
  me: AccountUser | null;
};

const isFriendsList = (value: unknown): value is FriendsList =>
  Boolean(value) && Array.isArray((value as FriendsList).friends) && Array.isArray((value as FriendsList).incoming);

/**
 * Friends, requests, conversations, recommendations and friends' activity of the signed-in
 * reader. Everything reloads when the account's long poll reports a social event
 * (`refresh`, wired in App) and when the window comes back. `version` bumps on each refresh so
 * an open conversation reloads its messages.
 */
export function useSocial({ client, signedIn, me }: Options) {
  const api = useMemo(() => socialApi(client), [client]);
  const [support, setSupport] = useState<SocialSupport>("unknown");
  const [friends, setFriends] = useState<FriendsList>(EMPTY_FRIENDS);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [feed, setFeed] = useState<ActivityItem[]>([]);
  const [version, setVersion] = useState(0);
  /** The lists came at least once (so "nothing there" is real, not "not yet"). */
  const [loaded, setLoaded] = useState(false);
  const loading = useRef<Promise<void> | null>(null);
  const again = useRef(false);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    // One load at a time; a request during one runs once more right after it.
    if (loading.current) {
      again.current = true;
      return loading.current;
    }
    loading.current = (async () => {
      do {
        again.current = false;
        const list = await api.friends();
        if (!list.ok || !isFriendsList(list.value)) {
          // Offline: keep what is on screen. Anything else: this server has no social side.
          if (!(!list.ok && list.error === "network")) setSupport("no");
          return;
        }
        setSupport("yes");
        setFriends(list.value);
        const [chats, recs, activity] = await Promise.all([api.conversations(), api.recommendations("all"), api.feed()]);
        if (chats.ok && Array.isArray(chats.value)) setConversations(chats.value);
        if (recs.ok && Array.isArray(recs.value)) setRecommendations(recs.value);
        if (activity.ok && Array.isArray(activity.value?.items)) setFeed(activity.value.items);
        setLoaded(true);
        setVersion((value) => value + 1);
      } while (again.current);
    })().finally(() => {
      loading.current = null;
    });
    return loading.current;
  }, [api, signedIn]);

  // Signed out (or another account): nothing from the last one stays on screen.
  useEffect(() => {
    if (!signedIn) {
      setSupport("unknown");
      setLoaded(false);
      setFriends(EMPTY_FRIENDS);
      setConversations([]);
      setRecommendations([]);
      setFeed([]);
      return;
    }
    void refresh();
  }, [me?.publicId, refresh, signedIn]);

  useEffect(() => {
    if (!signedIn) return;
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh, signedIn]);

  /** Runs an action, then reloads the lists (the server is the source of truth). */
  const act = useCallback(async <T,>(run: () => Promise<SocialResult<T>>): Promise<SocialResult<T>> => {
    const result = await run();
    if (result.ok) void refresh();
    return result;
  }, [refresh]);

  const unreadMessages = conversations.reduce((sum, conversation) => sum + (conversation.unread || 0), 0);
  const newRecommendations = recommendations.filter((rec) => rec.noteStatus === "new").length;
  /** The sidebar dot: unread messages, friend requests and new recommendations. */
  const attention = unreadMessages + friends.incoming.length + newRecommendations;

  const friendById = useCallback(
    (publicId: string): Friend | undefined => friends.friends.find((friend) => friend.publicId === publicId),
    [friends.friends]
  );

  return {
    api,
    /** Signed in and the server has the social side. */
    available: signedIn && support === "yes",
    support,
    loaded,
    me,
    friends,
    conversations,
    recommendations,
    feed,
    version,
    unreadMessages,
    newRecommendations,
    attention,
    friendById,
    refresh,
    lookup: api.lookup,
    requestFriend: (nickname: string) => act(() => api.requestFriend(nickname)),
    accept: (publicId: string) => act(() => api.accept(publicId)),
    remove: (publicId: string) => act(() => api.remove(publicId)),
    block: (publicId: string) => act(() => api.block(publicId)),
    unblock: (publicId: string) => act(() => api.unblock(publicId)),
    send: (publicId: string, message: Parameters<typeof api.send>[1]) => act(() => api.send(publicId, message)),
    markRead: (publicId: string) => act(() => api.markRead(publicId)),
    setNoteStatus: (id: number, status: "added" | "dismissed") => act(() => api.setNoteStatus(id, status)),
    setPrivacy: (patch: { libraryVisible?: boolean; activityVisible?: boolean }) => act(() => api.privacy(patch))
  };
}

export type SocialController = ReturnType<typeof useSocial>;
