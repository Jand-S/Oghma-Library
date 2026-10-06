import { useEffect, useState } from "react";
import type { BookSnapshot } from "../../core/types";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, Modal, cx, useToast } from "../../ui";
import { errorMessage } from "./FriendsPane";
import type { SocialController } from "./useSocial";

export type RecommendTarget = { novelId: string; snapshot: BookSnapshot } | null;

/** "Indicar a um amigo": pick one or more friends, write a note, send (a message with the book). */
export function RecommendDialog({ social, book, onClose }: { social: SocialController; book: RecommendTarget; onClose: () => void }) {
  const { toast } = useToast();
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set());
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!book) return;
    setChosen(new Set());
    setNote("");
  }, [book]);

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

  const friends = social.friends.friends;
  return (
    <Modal
      open={Boolean(book)}
      onClose={onClose}
      title={t.recommendTitle}
      size="md"
      dismissible={!sending}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>{t.back}</Button>
          <Button variant="primary" onClick={() => void send()} loading={sending} disabled={chosen.size === 0} data-testid="social-recommend-send">
            {t.recommendSend(chosen.size)}
          </Button>
        </>
      )}
    >
      {book ? (
        <div className="social-recommend">
          <div className="social-recommend__book">
            <Cover src={book.snapshot.coverUrl} title={book.snapshot.title} size="sm" />
            <div>
              <strong>{book.snapshot.title}</strong>
              <span>{[book.snapshot.author, book.snapshot.sourceName].filter(Boolean).join(" · ")}</span>
            </div>
          </div>
          <h4 className="social-recommend__label">{t.recommendPick}</h4>
          {friends.length === 0 ? (
            <p className="social-card__hint">{t.recommendNoFriends}</p>
          ) : (
            <ul className="social-recommend__friends" role="group" aria-label={t.recommendPick}>
              {friends.map((friend) => (
                <li key={friend.publicId}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={chosen.has(friend.publicId)}
                    className={cx("social-recommend__friend", chosen.has(friend.publicId) && "is-on")}
                    onClick={() => toggle(friend.publicId)}
                  >
                    <Avatar avatarId={friend.avatarId} color={friend.avatarColor} nickname={friend.nickname} size="md" />
                    <span>@{friend.nickname}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label className="social-recommend__label" htmlFor="social-recommend-note">{t.recommendNote}</label>
          <textarea
            id="social-recommend-note"
            className="social-recommend__note"
            rows={3}
            maxLength={2000}
            placeholder={t.recommendNotePlaceholder}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
      ) : null}
    </Modal>
  );
}
