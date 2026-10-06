import { BookmarkPlus, Check, ExternalLink, Send } from "lucide-react";
import type { BookSnapshot } from "../../core/types";
import { socialStrings as t } from "../../strings/social";
import { Button, Cover, cx } from "../../ui";
import { useSocialEnv } from "./socialEnv";

type BookCardProps = {
  novelId: string;
  snapshot?: BookSnapshot | null;
  /** "row": wide (recommendations, profile); "bubble": inside a chat message. */
  variant?: "row" | "bubble";
  /** Extra actions after the defaults (e.g. "Dispensar"). */
  children?: React.ReactNode;
  /** Shows "Indicar" too (the friend's profile). */
  canRecommend?: boolean;
  onAdded?: () => void;
};

/** A book in the social screens: cover, title, source, and Abrir / Adicionar à biblioteca. */
export function BookCard({ novelId, snapshot, variant = "row", children, canRecommend = false, onAdded }: BookCardProps) {
  const env = useSocialEnv();
  const novel = env.resolve(novelId);
  const title = novel?.title ?? snapshot?.title ?? novelId;
  const cover = novel?.coverUrl ?? snapshot?.coverUrl;
  const source = novel?.sourceName ?? snapshot?.sourceName;
  const author = novel?.author || snapshot?.author;
  const owned = env.inLibrary(novel?.id ?? novelId);
  return (
    <div className={cx("social-book", `social-book--${variant}`)} data-testid="social-book">
      <Cover src={cover} title={title} size="sm" className="social-book__cover" />
      <div className="social-book__text">
        <strong className="social-book__title" title={title}>{title}</strong>
        <span className="social-book__meta">{[author, source].filter(Boolean).join(" · ")}</span>
        <div className="social-book__actions">
          {novel ? (
            <Button variant="ghost" size="sm" icon={<ExternalLink />} onClick={() => env.openBook(novel)}>{t.open}</Button>
          ) : null}
          {owned ? (
            <span className="social-book__owned"><Check aria-hidden="true" />{t.inLibrary}</span>
          ) : novel ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<BookmarkPlus />}
              onClick={() => {
                env.addToLibrary(novel);
                onAdded?.();
              }}
            >
              {t.addToLibrary}
            </Button>
          ) : null}
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
