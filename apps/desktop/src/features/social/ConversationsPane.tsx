import { BookPlus, MessagesSquare, SendHorizontal } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { BookSnapshot } from "../../core/types";
import type { Message, UserCard } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, EmptyState, IconButton, cx, useToast } from "../../ui";
import { BookCard } from "./BookCard";
import { BookPicker } from "./BookPicker";
import { errorMessage } from "./FriendsPane";
import { shortWhen, useSocialEnv } from "./socialEnv";

/** Left: conversations (avatar, last line, unread). Right: the open conversation. */
export function ConversationsPane({ chat }: { chat?: string }) {
  const { social, go } = useSocialEnv();
  const open = chat ? social.friendById(chat) : undefined;
  // A friend with no messages yet still gets a row while their conversation is open.
  const rows: Array<{ friend: UserCard; last: Message | null; unread: number }> =
    social.conversations.some((row) => row.friend.publicId === chat) || !open
      ? social.conversations
      : [{ friend: open, last: null, unread: 0 }, ...social.conversations];

  return (
    <div className="social-chats" data-testid="social-chats">
      <nav className="social-chats__list" aria-label={t.tabs.chats}>
        {rows.length === 0 ? (
          <EmptyState icon={<MessagesSquare />} title={t.chatsEmptyTitle} description={t.chatsEmptyDescription} />
        ) : (
          <ul>
            {rows.map(({ friend, last, unread }) => (
              <li key={friend.publicId}>
                <button
                  type="button"
                  className={cx("social-chat-row", friend.publicId === chat && "is-active")}
                  aria-current={friend.publicId === chat ? "true" : undefined}
                  onClick={() => go({ chat: friend.publicId })}
                  data-testid="social-chat-row"
                >
                  <Avatar avatarId={friend.avatarId} color={friend.avatarColor} nickname={friend.nickname} size="md" />
                  <span className="social-chat-row__text">
                    <span className="social-chat-row__top">
                      <strong>@{friend.nickname}</strong>
                      {last ? <time dateTime={last.createdAt}>{shortWhen(last.createdAt)}</time> : null}
                    </span>
                    <span className="social-chat-row__last">
                      {last ? (last.novelId ? `${t.bookMessage}: ${last.snapshot?.title ?? ""}` : last.body) : ""}
                    </span>
                  </span>
                  {unread ? <span className="social-chat-row__badge" aria-label={t.unread(unread)}>{unread}</span> : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </nav>
      <section className="social-chats__thread">
        {chat ? <ChatThread key={chat} publicId={chat} /> : <EmptyState icon={<MessagesSquare />} title={t.pickChat} />}
      </section>
    </div>
  );
}

function ChatThread({ publicId }: { publicId: string }) {
  const { social } = useSocialEnv();
  const { toast } = useToast();
  const friend = social.friendById(publicId);
  const [messages, setMessages] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
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

  // Stay at the bottom as messages arrive, unless the reader scrolled up to read older ones.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  const loadOlder = async () => {
    const element = scroller.current;
    const before = messages[0]?.id;
    if (!before) return;
    const height = element?.scrollHeight ?? 0;
    const result = await social.api.messages(publicId, before);
    if (!result.ok) return;
    stick.current = false;
    setMessages((current) => [...result.value.messages, ...current]);
    setMore(result.value.more);
    requestAnimationFrame(() => {
      if (element) element.scrollTop = element.scrollHeight - height;
    });
  };

  const send = useCallback(async (message: { body?: string; novelId?: string; snapshot?: BookSnapshot }) => {
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

  const mine = (message: Message) => message.from !== publicId;

  return (
    <div className="social-thread">
      <header className="social-thread__head">
        <Avatar avatarId={friend?.avatarId} color={friend?.avatarColor} nickname={friend?.nickname} size="sm" />
        <strong>@{friend?.nickname ?? "…"}</strong>
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
        {messages.map((message, index) => {
          const previous = messages[index - 1];
          const showTime = !previous || new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() > 15 * 60_000;
          return (
            <Fragment key={message.id}>
              {showTime ? <time className="social-thread__time" dateTime={message.createdAt}>{shortWhen(message.createdAt)}</time> : null}
              <div className={cx("social-bubble", mine(message) ? "is-mine" : "is-theirs", message.novelId && "has-book")} data-testid="social-message">
                {message.novelId ? <BookCard novelId={message.novelId} snapshot={message.snapshot} variant="bubble" /> : null}
                {message.body ? <p className="social-bubble__body">{message.body}</p> : null}
              </div>
            </Fragment>
          );
        })}
      </div>
      <div className="social-composer">
        <IconButton label={t.attachBook} icon={<BookPlus />} variant="ghost" onClick={() => setPicking(true)} disabled={!friend} />
        <textarea
          className="social-composer__input"
          rows={1}
          placeholder={t.messagePlaceholder}
          aria-label={t.messageLabel(friend?.nickname ?? "")}
          value={draft}
          maxLength={2000}
          disabled={!friend}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          data-testid="social-composer"
        />
        <IconButton label={t.send} icon={<SendHorizontal />} variant="primary" onClick={() => void submit()} disabled={!draft.trim() || sending || !friend} />
      </div>
      <BookPicker open={picking} onClose={() => setPicking(false)} onPick={(book) => void send({ novelId: book.novelId, snapshot: book.snapshot })} />
    </div>
  );
}
