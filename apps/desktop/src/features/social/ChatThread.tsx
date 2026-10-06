import { ArrowUp, BookOpenText, ChevronRight, Plus, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { ActivityItem, Message } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, DropdownMenu, IconButton, StarRating, cx, useToast } from "../../ui";
import { BookCard } from "./BookCard";
import { BookPicker, type PickerMode } from "./BookPicker";
import { errorMessage, shortWhen, useSocialEnv, type SharedBook } from "./socialEnv";

const GAP_FOR_TIME = 15 * 60_000;

type Entry = { kind: "message"; at: number; message: Message } | { kind: "activity"; at: number; item: ActivityItem };

/** One conversation: a clean header (the friend, which opens their shelf), the transcript and the composer. */
export function ChatThread({ publicId }: { publicId: string }) {
  const { social, go } = useSocialEnv();
  const { toast } = useToast();
  const friend = social.friendById(publicId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState<PickerMode | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);
  /** Ids on screen after the first load; anything newer slides in. */
  const seen = useRef<Set<number> | null>(null);
  const unread = social.conversations.find((row) => row.friend.publicId === publicId)?.unread ?? 0;

  // Newest page on open and whenever a social event arrives; older pages stay when merging.
  useEffect(() => {
    let cancelled = false;
    void social.api.messages(publicId).then((result) => {
      if (cancelled || !result.ok) return;
      setMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        for (const message of result.value.messages) byId.set(message.id, message);
        return [...byId.values()].sort((a, b) => a.id - b.id);
      });
      setMore((current) => current || result.value.more);
    });
    return () => {
      cancelled = true;
    };
  }, [publicId, social.api, social.version]);

  useEffect(() => {
    if (unread > 0) void social.markRead(publicId);
  }, [publicId, social, unread]);

  useEffect(() => {
    if (seen.current === null && messages.length) seen.current = new Set(messages.map((message) => message.id));
  }, [messages]);

  // Stay at the bottom as messages arrive, unless the reader scrolled up to read older ones.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  // The field grows with the text, up to a few lines.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    input.current?.focus();
  }, [publicId]);

  // The friend's reading milestones between the messages ("terminou Shadow Slave ★★★★★").
  const entries = useMemo<Entry[]>(() => {
    const from = more && messages[0] ? new Date(messages[0].createdAt).getTime() : 0;
    const list: Entry[] = messages.map((message) => ({ kind: "message", at: new Date(message.createdAt).getTime(), message }));
    for (const item of social.feed) {
      const at = new Date(item.at).getTime();
      if (item.user.publicId === publicId && (item.kind === "finished" || item.kind === "started") && at >= from) list.push({ kind: "activity", at, item });
    }
    return list.sort((a, b) => a.at - b.at);
  }, [messages, more, publicId, social.feed]);

  const loadOlder = async () => {
    const element = scroller.current;
    const before = messages[0]?.id;
    if (!before) return;
    const height = element?.scrollHeight ?? 0;
    const result = await social.api.messages(publicId, before);
    if (!result.ok) return;
    stick.current = false;
    for (const message of result.value.messages) seen.current?.add(message.id);
    setMessages((current) => [...result.value.messages, ...current]);
    setMore(result.value.more);
    requestAnimationFrame(() => {
      if (element) element.scrollTop = element.scrollHeight - height;
    });
  };

  const send = useCallback(async (message: { body?: string } & Partial<SharedBook>) => {
    setSending(true);
    const result = await social.send(publicId, message);
    setSending(false);
    if (!result.ok) {
      toast({ message: result.error === "not_friends" ? t.notFriendsAnymore : errorMessage(result.error), tone: "danger" });
      return false;
    }
    stick.current = true;
    setMessages((current) => (current.some((item) => item.id === result.value.id) ? current : [...current, result.value]));
    return true;
  }, [publicId, social, toast]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    if (await send({ body })) setDraft("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submit();
    }
  };

  const reading = social.feed.find((item) => item.user.publicId === publicId && item.kind === "started")?.snapshot?.title;
  const mine = (message: Message) => message.from !== publicId;

  return (
    <div className="social-thread">
      <header className="social-thread__head">
        <button
          type="button"
          className="social-thread__who"
          onClick={() => go({ friend: publicId })}
          title={t.profileHint}
          disabled={!friend}
          data-testid="social-thread-profile"
        >
          <Avatar avatarId={friend?.avatarId} color={friend?.avatarColor} nickname={friend?.nickname} size="sm" />
          <span className="social-thread__name">
            <strong>{friend?.nickname ?? "…"}<ChevronRight aria-hidden="true" /></strong>
            <span>{reading ? t.reading(reading) : t.profileHint}</span>
          </span>
        </button>
      </header>

      <div
        className="social-thread__messages"
        ref={scroller}
        onScroll={(event) => {
          const element = event.currentTarget;
          stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
        data-testid="social-messages"
        aria-live="polite"
      >
        {more ? (
          <div className="social-thread__older">
            <Button variant="ghost" size="sm" onClick={() => void loadOlder()}>{t.loadOlder}</Button>
          </div>
        ) : null}
        {entries.map((entry, index) => {
          const previous = entries[index - 1];
          const showTime = !previous || entry.at - previous.at > GAP_FOR_TIME;
          const time = showTime ? (
            <time className="social-thread__time" dateTime={new Date(entry.at).toISOString()}>{shortWhen(new Date(entry.at).toISOString())}</time>
          ) : null;
          if (entry.kind === "activity") {
            const { item } = entry;
            return (
              <Fragment key={`a${item.id}`}>
                {time}
                <div className="social-milestone">
                  <span className="social-milestone__cover"><Cover src={item.snapshot?.coverUrl} title={item.snapshot?.title ?? ""} size="fill" /></span>
                  <span><strong>{friend?.nickname}</strong> {t.activity(item.kind)} <strong>{item.snapshot?.title}</strong></span>
                  {item.rating ? <StarRating size="xs" value={item.rating} compact /> : null}
                </div>
              </Fragment>
            );
          }
          const { message } = entry;
          const before = previous?.kind === "message" ? previous.message : null;
          const continued = !showTime && before !== null && mine(before) === mine(message);
          const fresh = seen.current !== null && !seen.current.has(message.id);
          return (
            <Fragment key={message.id}>
              {time}
              <div
                className={cx(
                  "social-bubble",
                  mine(message) ? "is-mine" : "is-theirs",
                  message.novelId && "has-book",
                  continued && "is-continued",
                  fresh && "is-new"
                )}
                data-testid="social-message"
              >
                {message.novelId ? (
                  <BookCard novelId={message.novelId} snapshot={message.snapshot} variant="bubble" eyebrow={t.recommendationEyebrow} />
                ) : null}
                {message.body ? <p className="social-bubble__body">{message.body}</p> : null}
              </div>
            </Fragment>
          );
        })}
      </div>

      <div className="social-composer">
        <DropdownMenu
          label={t.attachBook}
          className="social-attach-menu"
          items={[
            { label: t.attachFromLibrary, description: t.attachFromLibraryHint, icon: <BookOpenText />, onSelect: () => setPicking("library") },
            { label: t.attachFromCatalog, description: t.attachFromCatalogHint, icon: <Search />, onSelect: () => setPicking("catalog") }
          ]}
          trigger={<IconButton label={t.attachBook} icon={<Plus />} variant="ghost" className="social-composer__plus" disabled={!friend} />}
        />
        <div className="social-composer__field">
          <textarea
            ref={input}
            className="social-composer__input"
            rows={1}
            placeholder={t.messageLabel(friend?.nickname ?? "")}
            aria-label={t.messageLabel(friend?.nickname ?? "")}
            value={draft}
            maxLength={2000}
            disabled={!friend}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            data-testid="social-composer"
          />
        </div>
        <IconButton
          label={t.send}
          icon={<ArrowUp />}
          variant="primary"
          className={cx("social-composer__send", draft.trim() && "is-ready")}
          onClick={() => void submit()}
          disabled={!draft.trim() || sending || !friend}
        />
      </div>

      <BookPicker
        mode={picking}
        to={friend?.nickname}
        onClose={() => setPicking(null)}
        onPick={(book) => void send({ novelId: book.novelId, snapshot: book.snapshot })}
      />
    </div>
  );
}
