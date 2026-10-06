import { Ban, BookOpenText, Check, Gift, MessageCircle, Search, Send, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { useMemo, useState, type MouseEvent } from "react";
import { normalizeSearchText } from "../../core/tagFilters";
import type { Message, UserCard } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, DropdownMenu, IconButton, cx, type MenuItem, type MenuPoint } from "../../ui";
import { shortWhen, useSocialEnv } from "./socialEnv";

export type PersonActions = {
  openChat: (friend: UserCard) => void;
  openProfile: (friend: UserCard) => void;
  recommendTo: (friend: UserCard) => void;
  unfriend: (friend: UserCard) => void;
  block: (friend: UserCard) => void;
};

type Row = { friend: UserCard; last: Message | null; unread: number };

/**
 * The left column of Amigos, like Messages: title, add button, search, the pinned
 * Indicações and Pedidos rows, then every friend (conversations by recency first, then the
 * ones with no messages yet). Right-click (or the context-menu key) on a friend for the rest.
 */
export function PeopleColumn({ actions, onAdd }: { actions: PersonActions; onAdd: () => void }) {
  const { social, go } = useSocialEnv();
  const place = useSocialEnv().place;
  const [query, setQuery] = useState("");
  const [menu, setMenu] = useState<{ friend: UserCard; at: MenuPoint; unread: number } | null>(null);
  const { friends, incoming, outgoing } = social.friends;

  const rows = useMemo<Row[]>(() => {
    const talked = new Set(social.conversations.map((row) => row.friend.publicId));
    const quiet = friends
      .filter((friend) => !talked.has(friend.publicId))
      .sort((a, b) => a.nickname.localeCompare(b.nickname, "pt-BR"))
      .map((friend) => ({ friend, last: null, unread: 0 }));
    const all: Row[] = [...social.conversations, ...quiet];
    const wanted = normalizeSearchText(query.replace(/^@/, ""));
    return wanted ? all.filter((row) => normalizeSearchText(row.friend.nickname).includes(wanted)) : all;
  }, [friends, query, social.conversations]);

  /** "Lendo X" for a friend with nothing said yet (their latest start in the activity feed). */
  const readingOf = (publicId: string) => social.feed.find((item) => item.user.publicId === publicId && item.kind === "started")?.snapshot?.title;

  const preview = (row: Row) => {
    if (!row.last) {
      const reading = readingOf(row.friend.publicId);
      return reading ? t.reading(reading) : t.sayHi;
    }
    const mine = row.last.from !== row.friend.publicId;
    const text = row.last.novelId ? `${mine ? t.youRecommended : t.theyRecommended}: ${row.last.snapshot?.title ?? ""}` : row.last.body;
    return mine && !row.last.novelId ? `${t.you}: ${text}` : text;
  };

  const menuItems = (friend: UserCard, unread: number): MenuItem[] => [
    { label: t.viewShelf, icon: <BookOpenText />, onSelect: () => actions.openProfile(friend) },
    { label: t.recommendTo, icon: <Send />, onSelect: () => actions.recommendTo(friend) },
    { label: t.chat, icon: <MessageCircle />, onSelect: () => actions.openChat(friend) },
    ...(unread ? [{ label: t.markRead, icon: <Check />, onSelect: () => void social.markRead(friend.publicId) }] : []),
    { label: t.unfriend, icon: <UserMinus />, separatorBefore: true, onSelect: () => actions.unfriend(friend) },
    { label: t.blockNamed(friend.nickname), icon: <Ban />, danger: true, onSelect: () => actions.block(friend) }
  ];

  const openMenu = (row: Row) => (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // The context-menu key has no pointer position: open under the row.
    const rect = event.currentTarget.getBoundingClientRect();
    const at = event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : { x: rect.left + rect.width / 2, y: rect.bottom };
    setMenu({ friend: row.friend, at, unread: row.unread });
  };

  const active = place.chat ?? place.friend;
  const requests = incoming.length + outgoing.length;

  return (
    <nav className="social-people" aria-label={t.peopleLabel} data-testid="social-people">
      {/* The page header already says "Amigos": the column starts with search and add, like Messages. */}
      <div className="social-people__head">
        <label className="social-search">
          <Search aria-hidden="true" />
          <input
            type="search"
            placeholder={t.searchPeople}
            aria-label={t.searchPeopleLabel}
            value={query}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
        </label>
        <span className="social-people__add">
          <IconButton label={t.addFriend} icon={<UserPlus />} variant="ghost" onClick={onAdd} data-testid="social-add-friend" />
          {incoming.length ? <span className="social-people__dot" aria-hidden="true" /> : null}
        </span>
      </div>

      <div className="social-people__scroll">
        {query ? null : (
          <ul className="social-people__pinned" role="list">
            <li>
              <button
                type="button"
                className={cx("social-row", place.pane === "recommendations" && "is-active")}
                aria-current={place.pane === "recommendations" ? "page" : undefined}
                onClick={() => go({ pane: "recommendations" })}
                data-testid="social-row-recommendations"
              >
                <span className="social-row__tile social-row__tile--accent" aria-hidden="true"><Gift /></span>
                <span className="social-row__text">
                  <span className="social-row__top"><strong>{t.recsRow}</strong></span>
                  <span className="social-row__last">{t.recsRowHint(social.newRecommendations)}</span>
                </span>
                {social.newRecommendations ? <span className="social-row__count">{social.newRecommendations}</span> : null}
              </button>
            </li>
            {requests ? (
              <li>
                <button type="button" className="social-row" onClick={onAdd} data-testid="social-row-requests">
                  <span className="social-row__tile" aria-hidden="true"><UserCheck /></span>
                  <span className="social-row__text">
                    <span className="social-row__top"><strong>{t.requestsRow}</strong></span>
                    <span className="social-row__last">{t.requestsRowHint(incoming[0]?.nickname, outgoing.length)}</span>
                  </span>
                  {incoming.length ? <span className="social-row__count social-row__count--quiet">{incoming.length}</span> : null}
                </button>
              </li>
            ) : null}
          </ul>
        )}

        {rows.length ? (
          <>
            {query ? null : <h2 className="social-people__label">{t.conversations}</h2>}
            <ul className="social-people__list" role="list">
              {rows.map((row) => {
                const isActive = row.friend.publicId === active;
                return (
                  <li key={row.friend.publicId}>
                    <button
                      type="button"
                      className={cx("social-row", isActive && "is-active", row.unread > 0 && "is-unread", menu?.friend.publicId === row.friend.publicId && "is-menu")}
                      aria-current={isActive ? "true" : undefined}
                      onClick={() => actions.openChat(row.friend)}
                      onContextMenu={openMenu(row)}
                      data-testid="social-chat-row"
                    >
                      <Avatar avatarId={row.friend.avatarId} color={row.friend.avatarColor} nickname={row.friend.nickname} size="md" />
                      <span className="social-row__text">
                        <span className="social-row__top">
                          <strong>{row.friend.nickname}</strong>
                          {row.last ? <time dateTime={row.last.createdAt}>{shortWhen(row.last.createdAt)}</time> : null}
                        </span>
                        <span className="social-row__last">{preview(row)}</span>
                      </span>
                      {row.unread ? <span className="social-row__unread" aria-label={t.unread(row.unread)} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : query ? (
          <p className="social-people__empty">{t.noMatch}</p>
        ) : null}
      </div>

      <DropdownMenu
        label={menu ? t.friendMenu(menu.friend.nickname) : undefined}
        items={menu ? menuItems(menu.friend, menu.unread) : []}
        open={Boolean(menu)}
        position={menu?.at ?? null}
        onClose={() => setMenu(null)}
      />
    </nav>
  );
}
