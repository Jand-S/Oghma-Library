import { Check, Plus, Send } from "lucide-react";
import type { BookSnapshot } from "../../core/types";
import { socialStrings as t } from "../../strings/social";
import { Button, Cover, cx } from "../../ui";
import { chapterCount, useSocialEnv } from "./socialEnv";

type BookCardProps = {
  novelId: string;
  snapshot?: BookSnapshot | null;
  /** "bubble": inside a chat message; "row": a plain wide card. */
  variant?: "row" | "bubble";
  /** Small caption above the title ("Indicação"). */
  eyebrow?: string;
  /** Extra actions after the defaults (e.g. "Dispensar"). */
  children?: React.ReactNode;
  /** Shows "Indicar" too. */
  canRecommend?: boolean;
  onAdded?: () => void;
};

/** A book in the social screens: cover, title, author · source, and Adicionar à biblioteca / Abrir. */
export function BookCard({ novelId, snapshot, variant = "row", eyebrow, children, canRecommend = false, onAdded }: BookCardProps) {
  const env = useSocialEnv();
  const novel = env.resolve(novelId);
  const title = novel?.title ?? snapshot?.title ?? novelId;
  const cover = novel?.coverUrl ?? snapshot?.coverUrl;
  const source = novel?.sourceName ?? snapshot?.sourceName;
  const author = novel?.author || snapshot?.author;
  const chapters = novel?.chapters ?? chapterCount(snapshot?.chapters);
  const owned = env.inLibrary(novel?.id ?? novelId);
  return (
    <div className={cx("social-book", `social-book--${variant}`)} data-testid="social-book">
      <button
        type="button"
        className="social-book__cover"
        onClick={() => (novel ? env.openBook(novel) : undefined)}
        disabled={!novel}
        aria-label={`${t.open}: ${title}`}
      >
        <Cover src={cover} title={title} size="fill" sheen />
      </button>
      <div className="social-book__text">
        {eyebrow ? <span className="social-book__eyebrow">{eyebrow}</span> : null}
        <strong className="social-book__title" title={title}>{title}</strong>
        <span className="social-book__meta">{[author, source].filter(Boolean).join(" · ")}</span>
        {chapters ? <span className="social-book__meta">{t.chapters(chapters)}</span> : null}
        <div className="social-book__actions">
          {owned ? (
            <span className="social-book__owned"><Check aria-hidden="true" />{t.inYourLibrary}</span>
          ) : novel ? (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus />}
              onClick={() => {
                env.addToLibrary(novel);
                onAdded?.();
              }}
            >
              {t.addToLibrary}
            </Button>
          ) : null}
          {novel ? <Button variant="glass" size="sm" onClick={() => env.openBook(novel)}>{t.open}</Button> : null}
          {canRecommend ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Send />}
              onClick={() => env.recommend({ novelId, snapshot: snapshot ?? { novelId, title, coverUrl: cover, sourceName: source, author: author || undefined } })}
            >
              {t.recommend}
            </Button>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
