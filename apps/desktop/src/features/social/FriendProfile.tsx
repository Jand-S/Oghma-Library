import { Ban, Check, ChevronLeft, EyeOff, Heart, MessageCircle, MoreHorizontal, Plus, Send, UserMinus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Novel } from "../../core/types";
import type { FriendLibrary, FriendLibraryEntry } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, DropdownMenu, EmptyState, IconButton, Skeleton, StarRating } from "../../ui";
import type { PersonActions } from "./PeopleColumn";
import { errorMessage, longDate, useSocialEnv } from "./socialEnv";

const SHELVES = ["completed", "paused", "unread", "dropped"] as const;

/** A friend's page: who they are, a few numbers, what they read now and the rest of the shelf. */
export function FriendProfile({ publicId, actions }: { publicId: string; actions: PersonActions }) {
  const env = useSocialEnv();
  const { social, go } = env;
  const friend = social.friendById(publicId);
  const [library, setLibrary] = useState<FriendLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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

  useEffect(() => setLibrary(null), [publicId]);

  const entries = library && !library.hidden ? library.entries : [];
  const novelOf = (entry: FriendLibraryEntry) => env.resolve(entry.novelId);
  const owned = (entry: FriendLibraryEntry) => env.inLibrary(novelOf(entry)?.id ?? entry.novelId);

  const model = useMemo(() => {
    const byStatus = new Map<string, FriendLibraryEntry[]>();
    for (const entry of entries) {
      const status = entry.readingStatus ?? "unread";
      byStatus.set(status, [...(byStatus.get(status) ?? []), entry]);
    }
    for (const [status, list] of byStatus) {
      // Finished books: best rated first; the rest: most recent first.
      list.sort((a, b) => (status === "completed" ? (b.rating ?? 0) - (a.rating ?? 0) : 0) || (b.changedAt ?? 0) - (a.changedAt ?? 0));
    }
    const rated = entries.filter((entry) => entry.rating);
    const average = rated.length ? rated.reduce((sum, entry) => sum + (entry.rating ?? 0), 0) / rated.length : null;
    return { byStatus, average };
  }, [entries]);
  const common = entries.filter(owned).length;
  const reading = model.byStatus.get("reading") ?? [];

  const titleOf = (entry: FriendLibraryEntry, novel?: Novel) => novel?.title ?? entry.snapshot?.title ?? entry.novelId;
  const recommend = (entry: FriendLibraryEntry, novel?: Novel) => env.recommend({
    novelId: entry.novelId,
    snapshot: entry.snapshot ?? { novelId: entry.novelId, title: titleOf(entry, novel), coverUrl: novel?.coverUrl }
  });

  return (
    <div className="social-profile" data-testid="social-profile">
      <header className="social-profile__head">
        <button type="button" className="social-back" onClick={() => go({ chat: publicId })}>
          <ChevronLeft aria-hidden="true" />{t.backToChat}
        </button>
        <div className="social-profile__hero">
          <Avatar avatarId={friend?.avatarId} color={friend?.avatarColor} nickname={friend?.nickname} size="xl" />
          <div className="social-profile__who">
            <h2>{friend?.nickname ?? "…"}</h2>
            <p>
              {friend?.since ? t.friendsSinceShort(longDate(friend.since)) : null}
              {reading[0] ? <>{friend?.since ? " · " : ""}{t.reading("")}<strong>{titleOf(reading[0], novelOf(reading[0]))}</strong></> : null}
            </p>
          </div>
          <Button variant="primary" icon={<MessageCircle />} onClick={() => go({ chat: publicId })}>{t.message}</Button>
          {friend ? (
            <DropdownMenu
              label={t.friendMenu(friend.nickname)}
              align="end"
              items={[
                { label: t.recommendTo, icon: <Send />, onSelect: () => actions.recommendTo(friend) },
                { label: t.unfriend, icon: <UserMinus />, separatorBefore: true, onSelect: () => actions.unfriend(friend) },
                { label: t.blockNamed(friend.nickname), icon: <Ban />, danger: true, onSelect: () => actions.block(friend) }
              ]}
              trigger={<IconButton label={t.friendMenu(friend.nickname)} icon={<MoreHorizontal />} variant="glass" />}
            />
          ) : null}
        </div>
      </header>

      <div className="social-profile__body">
        {error ? <p className="social-error" role="alert">{error}</p> : null}
        {!library && !error ? (
          <div className="social-profile__loading" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="social-profile__skeleton" height="auto" />)}
          </div>
        ) : null}
        {library?.hidden ? <EmptyState icon={<EyeOff />} title={t.hiddenLibrary} /> : null}
        {library && !library.hidden && entries.length === 0 ? <EmptyState title={t.emptyLibrary} /> : null}

        {entries.length ? (
          <>
            <dl className="social-stats">
              <div><dt>{t.stats.shelf}</dt><dd>{entries.length.toLocaleString("pt-BR")}</dd></div>
              <div><dt>{t.stats.completed}</dt><dd>{(model.byStatus.get("completed")?.length ?? 0).toLocaleString("pt-BR")}</dd></div>
              <div>
                <dt>{t.stats.rating}</dt>
                <dd>{model.average ? <>{model.average.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<span className="social-stats__star" aria-hidden="true">★</span></> : "–"}</dd>
              </div>
              <div className="social-stats__common"><dt>{t.stats.common}</dt><dd>{common.toLocaleString("pt-BR")}</dd></div>
            </dl>

            {reading.length ? (
              <section className="social-section" aria-labelledby="social-reading-now">
                <h3 id="social-reading-now" className="social-section__title">{t.readingNow} <span>{reading.length}</span></h3>
                <ul className="social-reading" role="list">
                  {reading.map((entry) => {
                    const novel = novelOf(entry);
                    const title = titleOf(entry, novel);
                    const mine = owned(entry);
                    return (
                      <li key={entry.novelId} className="social-reading__card">
                        <button type="button" className="social-reading__cover" onClick={() => (novel ? env.openBook(novel) : undefined)} disabled={!novel} aria-label={title}>
                          <Cover src={novel?.coverUrl ?? entry.snapshot?.coverUrl} title={title} size="fill" sheen />
                          {mine ? <span className="social-mine" title={t.inLibrary}><Check aria-hidden="true" /></span> : null}
                        </button>
                        <div className="social-reading__text">
                          <strong title={title}>{title}</strong>
                          <span>{[novel?.sourceName ?? entry.snapshot?.sourceName, novel?.chapters ? t.chapters(novel.chapters) : null].filter(Boolean).join(" · ")}</span>
                          {mine ? <span className="social-reading__you">{t.youToo}</span> : null}
                          <div className="social-reading__actions">
                            {!mine && novel ? <Button variant="primary" size="sm" icon={<Plus />} onClick={() => env.addToLibrary(novel)}>{t.addShort}</Button> : null}
                            {novel ? <Button variant="glass" size="sm" onClick={() => env.openBook(novel)}>{t.open}</Button> : null}
                            <IconButton label={`${t.recommend}: ${title}`} icon={<Send />} size="sm" variant="ghost" onClick={() => recommend(entry, novel)} />
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

            {SHELVES.filter((status) => model.byStatus.get(status)?.length).map((status) => (
              <section key={status} className="social-section" aria-label={t.shelfGroups[status]}>
                <h3 className="social-section__title">{t.shelfGroups[status]} <span>{model.byStatus.get(status)!.length}</span></h3>
                <ul className="social-shelf" role="list">
                  {model.byStatus.get(status)!.map((entry) => {
                    const novel = novelOf(entry);
                    const title = titleOf(entry, novel);
                    const mine = owned(entry);
                    return (
                      <li key={entry.novelId} className="social-shelf__item">
                        <div className="social-shelf__art">
                          <button type="button" className="social-shelf__cover" onClick={() => (novel ? env.openBook(novel) : undefined)} disabled={!novel} aria-label={title}>
                            <Cover src={novel?.coverUrl ?? entry.snapshot?.coverUrl} title={title} size="fill" sheen />
                          </button>
                          {mine ? <span className="social-mine" title={t.inLibrary}><Check aria-hidden="true" /></span> : null}
                          {entry.favorite ? <span className="social-shelf__fav" aria-hidden="true"><Heart /></span> : null}
                          <span className="social-shelf__hover">
                            {!mine && novel ? (
                              <IconButton label={`${t.addToLibrary}: ${title}`} icon={<Plus />} size="sm" variant="glass" onClick={() => env.addToLibrary(novel)} />
                            ) : null}
                            <IconButton label={`${t.recommend}: ${title}`} icon={<Send />} size="sm" variant="glass" onClick={() => recommend(entry, novel)} />
                          </span>
                        </div>
                        <span className="social-shelf__title" title={title}>{title}</span>
                        {entry.rating ? <StarRating size="xs" value={entry.rating} compact /> : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </>
        ) : null}
      </div>
    </div>
  );
}
