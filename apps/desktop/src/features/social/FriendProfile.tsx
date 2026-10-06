import { BookmarkPlus, EyeOff, Heart, MessageCircle, Send } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FriendLibrary, FriendLibraryEntry } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, EmptyState, IconButton, Skeleton, StarRating } from "../../ui";
import { errorMessage } from "./FriendsPane";
import { useSocialEnv } from "./socialEnv";

const GROUPS = ["reading", "paused", "completed", "dropped", "unread"] as const;

/** A friend's shelf by reading status, with what you both have ("em comum"). */
export function FriendProfile({ publicId }: { publicId: string }) {
  const env = useSocialEnv();
  const { social, go } = env;
  const friend = social.friendById(publicId);
  const [library, setLibrary] = useState<FriendLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLibrary(null);
    setError(null);
    void social.api.library(publicId).then((result) => {
      if (cancelled) return;
      if (result.ok) setLibrary(result.value);
      else setError(errorMessage(result.error));
    });
    return () => {
      cancelled = true;
    };
  }, [publicId, social.api, social.version]); // a social event (version) reloads the shelf

  const canonical = (entry: FriendLibraryEntry) => env.resolve(entry.novelId)?.id ?? entry.novelId;
  const common = (library?.entries ?? []).filter((entry) => env.inLibrary(canonical(entry))).length;
  const grouped = useMemo(() => {
    const byStatus = new Map<string, FriendLibraryEntry[]>();
    for (const entry of library?.entries ?? []) {
      const status = entry.readingStatus ?? "unread";
      byStatus.set(status, [...(byStatus.get(status) ?? []), entry]);
    }
    for (const list of byStatus.values()) list.sort((a, b) => (b.changedAt ?? 0) - (a.changedAt ?? 0));
    return byStatus;
  }, [library]);

  return (
    <div className="social-profile" data-testid="social-profile">
      <header className="social-profile__head">
        <Avatar avatarId={friend?.avatarId} color={friend?.avatarColor} nickname={friend?.nickname} size="xl" />
        <div className="social-profile__who">
          <h2>@{friend?.nickname ?? "…"}</h2>
          <p>{library && !library.hidden ? t.inCommon(common) : null}</p>
        </div>
        <Button variant="primary" icon={<MessageCircle />} onClick={() => go({ tab: "chats", chat: publicId, friend: undefined })}>{t.chat}</Button>
      </header>

      {error ? <p className="social-add__error" role="alert">{error}</p> : null}
      {!library && !error ? (
        <div className="social-profile__loading" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="social-profile__skeleton" height="auto" />)}
        </div>
      ) : null}
      {library?.hidden ? <EmptyState icon={<EyeOff />} title={t.hiddenLibrary} /> : null}
      {library && !library.hidden && library.entries.length === 0 ? <EmptyState title={t.emptyLibrary} /> : null}

      {library && !library.hidden
        ? GROUPS.filter((status) => grouped.get(status)?.length).map((status) => (
          <section key={status} className="social-section" aria-label={t.shelfGroups[status]}>
            <h3 className="social-section__title">{t.shelfGroups[status]} <span>{grouped.get(status)!.length}</span></h3>
            <ul className="social-shelf">
              {grouped.get(status)!.map((entry) => {
                const novel = env.resolve(entry.novelId);
                const title = novel?.title ?? entry.snapshot?.title ?? entry.novelId;
                const mine = env.inLibrary(canonical(entry));
                return (
                  <li key={entry.novelId} className="social-shelf__item">
                    <button
                      type="button"
                      className="social-shelf__cover"
                      onClick={() => (novel ? env.openBook(novel) : undefined)}
                      disabled={!novel}
                      aria-label={title}
                    >
                      <Cover src={novel?.coverUrl ?? entry.snapshot?.coverUrl} title={title} size="fill" sheen />
                      {entry.favorite ? <span className="social-shelf__fav" aria-hidden="true"><Heart /></span> : null}
                      {mine ? <span className="social-shelf__mine">{t.inLibrary}</span> : null}
                    </button>
                    <span className="social-shelf__title" title={title}>{title}</span>
                    {entry.rating ? <StarRating size="xs" value={entry.rating} compact /> : null}
                    <span className="social-shelf__actions">
                      {!mine && novel ? (
                        <IconButton label={`${t.addToLibrary}: ${title}`} icon={<BookmarkPlus />} size="sm" variant="ghost" onClick={() => env.addToLibrary(novel)} />
                      ) : null}
                      <IconButton
                        label={`${t.recommend}: ${title}`}
                        icon={<Send />}
                        size="sm"
                        variant="ghost"
                        onClick={() => env.recommend({
                          novelId: entry.novelId,
                          snapshot: entry.snapshot ?? { novelId: entry.novelId, title, coverUrl: novel?.coverUrl }
                        })}
                      />
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
        : null}
    </div>
  );
}
