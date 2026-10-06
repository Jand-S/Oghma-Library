import { Check, Gift, MessageCircle, Plus } from "lucide-react";
import type { Recommendation } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Cover, EmptyState } from "../../ui";
import { chapterCount, shortWhen, useSocialEnv } from "./socialEnv";

/** Books friends sent: large cards for the new ones, a quiet list of the ones already seen. */
export function RecommendationsPane() {
  const { social } = useSocialEnv();
  const fresh = social.recommendations.filter((rec) => rec.noteStatus === "new");
  const seen = social.recommendations.filter((rec) => rec.noteStatus !== "new");
  return (
    <div className="social-recs" data-testid="social-recommendations">
      <header className="social-pane-head">
        <div>
          <h2>{t.recsRow}</h2>
          <p>{t.recsHeaderHint}</p>
        </div>
      </header>
      <div className="social-recs__body">
        {social.recommendations.length === 0 ? (
          <EmptyState icon={<Gift />} title={t.recsEmptyTitle} description={t.recsEmptyDescription} />
        ) : null}
        {fresh.length ? (
          <ul className="social-recs__list" role="list">
            {fresh.map((rec) => <RecCard key={rec.id} rec={rec} />)}
          </ul>
        ) : null}
        {seen.length ? (
          <section className="social-recs__seen" aria-labelledby="social-recs-seen">
            <h3 id="social-recs-seen" className="social-people__label">{t.recsSeen}</h3>
            <ul role="list">
              {seen.map((rec) => <SeenRow key={rec.id} rec={rec} />)}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function RecCard({ rec }: { rec: Recommendation }) {
  const env = useSocialEnv();
  const { social, go } = env;
  const novelId = rec.novelId ?? "";
  const novel = env.resolve(novelId);
  const title = novel?.title ?? rec.snapshot?.title ?? novelId;
  const owned = env.inLibrary(novel?.id ?? novelId);
  const chapters = novel?.chapters ?? chapterCount(rec.snapshot?.chapters);
  // Other friends who read it (from the activity feed).
  const readers = [...new Map(
    social.feed
      .filter((item) => item.novelId === novelId && item.user.publicId !== rec.from && item.kind !== "dropped")
      .map((item) => [item.user.publicId, item.user])
  ).values()].slice(0, 3);
  return (
    <li className="social-rec" data-testid="social-recommendation">
      <button type="button" className="social-rec__cover" onClick={() => (novel ? env.openBook(novel) : undefined)} disabled={!novel} aria-label={title}>
        <Cover src={novel?.coverUrl ?? rec.snapshot?.coverUrl} title={title} size="fill" sheen />
      </button>
      <div className="social-rec__main">
        <div className="social-rec__who">
          <Avatar avatarId={rec.fromUser.avatarId} color={rec.fromUser.avatarColor} nickname={rec.fromUser.nickname} size="xs" />
          <span><strong>{rec.fromUser.nickname}</strong> {t.recommendedVerb} · <time dateTime={rec.createdAt}>{shortWhen(rec.createdAt)}</time></span>
          <span className="social-rec__new" aria-label={t.recsNew} />
        </div>
        <div>
          <h3 className="social-rec__title">{title}</h3>
          <p className="social-rec__meta">{[novel?.author || rec.snapshot?.author, novel?.sourceName ?? rec.snapshot?.sourceName, chapters ? t.chapters(chapters) : null].filter(Boolean).join(" · ")}</p>
        </div>
        {rec.body ? <blockquote className="social-rec__note">{rec.body}</blockquote> : <p className="social-rec__no-note">{t.noNote}</p>}
        {readers.length ? (
          <p className="social-rec__readers">
            <span className="social-rec__faces" aria-hidden="true">
              {readers.map((user) => <Avatar key={user.publicId} avatarId={user.avatarId} color={user.avatarColor} nickname={user.nickname} size="xs" />)}
            </span>
            {t.alsoRead(readers.map((user) => user.nickname))}
          </p>
        ) : null}
        <div className="social-rec__actions">
          {owned ? (
            <span className="social-book__owned"><Check aria-hidden="true" />{t.inYourLibrary}</span>
          ) : novel ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus />}
              onClick={() => {
                env.addToLibrary(novel);
                void social.setNoteStatus(rec.id, "added");
              }}
            >
              {t.addToLibrary}
            </Button>
          ) : null}
          {novel ? <Button variant="glass" size="sm" onClick={() => env.openBook(novel)} title={t.openInDiscover}>{t.open}</Button> : null}
          <Button variant="glass" size="sm" icon={<MessageCircle />} onClick={() => go({ chat: rec.from })}>{t.reply}</Button>
          <Button variant="ghost" size="sm" className="social-rec__dismiss" onClick={() => void social.setNoteStatus(rec.id, owned ? "added" : "dismissed")}>
            {owned ? t.markSeen : t.dismiss}
          </Button>
        </div>
      </div>
    </li>
  );
}

function SeenRow({ rec }: { rec: Recommendation }) {
  const env = useSocialEnv();
  const novelId = rec.novelId ?? "";
  const novel = env.resolve(novelId);
  const title = novel?.title ?? rec.snapshot?.title ?? novelId;
  const owned = env.inLibrary(novel?.id ?? novelId);
  return (
    <li>
      <button type="button" className="social-seen" onClick={() => (novel ? env.openBook(novel) : undefined)} disabled={!novel}>
        <span className="social-seen__cover"><Cover src={novel?.coverUrl ?? rec.snapshot?.coverUrl} title={title} size="fill" /></span>
        <span className="social-seen__text">
          <strong>{title}</strong>
          <span>{rec.fromUser.nickname} · {shortWhen(rec.createdAt)}</span>
        </span>
        {owned || rec.noteStatus === "added" ? (
          <span className="social-book__owned"><Check aria-hidden="true" />{t.inYourLibrary}</span>
        ) : (
          <span className="social-seen__status">{t.dismissed}</span>
        )}
      </button>
    </li>
  );
}
