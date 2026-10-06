import { Check, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { normalizeSearchText } from "../../core/tagFilters";
import type { BookSnapshot } from "../../core/types";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, Modal, cx, useToast } from "../../ui";
import { chapterCount, errorMessage } from "./socialEnv";
import type { SocialController } from "./useSocial";

export type RecommendTarget = { novelId: string; snapshot: BookSnapshot } | null;

/**
 * "Indicar para…", like forwarding on WhatsApp: the book on top, friends you talk to most
 * recently first, pick one or more, an optional note, send (one message with the book each).
 */
export function RecommendDialog({ social, book, onClose }: { social: SocialController; book: RecommendTarget; onClose: () => void }) {
  const { toast } = useToast();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [query, setQuery] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!book) return;
    setChosen(new Set());
    setNote("");
    setQuery("");
  }, [book]);

  const friends = useMemo(() => {
    const recency = new Map(social.conversations.map((row, index) => [row.friend.publicId, index]));
    const sorted = [...social.friends.friends].sort((a, b) =>
      (recency.get(a.publicId) ?? Infinity) - (recency.get(b.publicId) ?? Infinity) || a.nickname.localeCompare(b.nickname, "pt-BR"));
    const wanted = normalizeSearchText(query.replace(/^@/, ""));
    return wanted ? sorted.filter((friend) => normalizeSearchText(friend.nickname).includes(wanted)) : sorted;
  }, [query, social.conversations, social.friends.friends]);
  const picked = social.friends.friends.filter((friend) => chosen.has(friend.publicId));

  const toggle = (publicId: string) => setChosen((current) => {
    const next = new Set(current);
    if (next.has(publicId)) next.delete(publicId);
    else next.add(publicId);
    return next;
  });

  const send = async () => {
    if (!book || chosen.size === 0) return;
    setSending(true);
    const results = await Promise.all(
      [...chosen].map((publicId) => social.send(publicId, { body: note.trim() || undefined, novelId: book.novelId, snapshot: book.snapshot }))
    );
    setSending(false);
    const failed = results.find((result) => !result.ok);
    if (failed && !failed.ok) {
      toast({ message: errorMessage(failed.error), tone: "danger" });
      return;
    }
    toast({ message: t.recommendSent(chosen.size), tone: "success" });
    onClose();
  };

  const recentLabel = query ? null : <h4 className="social-people__label">{t.recent}</h4>;

  return (
    <Modal
      open={Boolean(book)}
      onClose={onClose}
      size="sm"
      className="social-forward"
      dismissible={!sending}
      title={book ? (
        <span className="social-forward__book">
          <span className="social-forward__cover"><Cover src={book.snapshot.coverUrl} title={book.snapshot.title} size="fill" sheen /></span>
          <span className="social-forward__what">
            <span>{t.recommendEyebrow}</span>
            <strong>{book.snapshot.title}</strong>
            <span>{[book.snapshot.sourceName, chapterCount(book.snapshot.chapters) ? t.chapters(chapterCount(book.snapshot.chapters)!) : null].filter(Boolean).join(" · ")}</span>
          </span>
        </span>
      ) : t.recommendTitle}
      footer={(
        <>
          <Button variant="glass" onClick={onClose} disabled={sending}>{t.cancel}</Button>
          <Button variant="primary" onClick={() => void send()} loading={sending} disabled={chosen.size === 0} data-testid="social-recommend-send">
            {t.recommendSend(chosen.size)}
          </Button>
        </>
      )}
    >
      {social.friends.friends.length === 0 ? (
        <p className="social-forward__empty">{t.recommendNoFriends}</p>
      ) : (
        <>
          <label className="social-search">
            <Search aria-hidden="true" />
            <input type="search" placeholder={t.recommendSearch} aria-label={t.recommendSearch} value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
          <div className="social-forward__list">
            {recentLabel}
            <ul role="group" aria-label={t.recommendPick}>
              {friends.map((friend) => {
                const on = chosen.has(friend.publicId);
                return (
                  <li key={friend.publicId}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className={cx("social-forward__friend", on && "is-on")}
                      onClick={() => toggle(friend.publicId)}
                    >
                      <Avatar avatarId={friend.avatarId} color={friend.avatarColor} nickname={friend.nickname} size="md" />
                      <span className="social-forward__name">{friend.nickname}</span>
                      <span className="social-forward__check" aria-hidden="true"><Check /></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div className={cx("social-forward__compose", picked.length > 0 && "is-open")}>
            {picked.length ? (
              <p className="social-forward__picked">
                <span className="social-rec__faces" aria-hidden="true">
                  {picked.slice(0, 4).map((friend) => <Avatar key={friend.publicId} avatarId={friend.avatarId} color={friend.avatarColor} nickname={friend.nickname} size="xs" />)}
                </span>
                {t.pickedNames(picked.map((friend) => friend.nickname))}
              </p>
            ) : null}
            <input
              className="social-forward__note"
              aria-label={t.recommendNote}
              placeholder={t.recommendNoteShort}
              value={note}
              maxLength={2000}
              onChange={(event) => setNote(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
          </div>
        </>
      )}
    </Modal>
  );
}
