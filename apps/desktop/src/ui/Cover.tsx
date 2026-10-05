import { Eye } from "lucide-react";
import { useEffect, useState, type KeyboardEvent, type MouseEvent } from "react";
import { uiStrings } from "../strings/common";
import { useCoverPrivacy } from "./CoverPrivacy";
import { cx } from "./cx";
import "./Cover.css";

export type CoverProps = {
  src?: string | null;
  title: string;
  /** sm 48px, md 120px, lg 180px wide; fill takes the container width. */
  size?: "sm" | "md" | "lg" | "fill";
  /** Adds a subtle glossy highlight. */
  sheen?: boolean;
  className?: string;
};

export function coverInitials(title: string) {
  const words = title.trim().split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0].slice(0, 2) : `${words[0][0]}${words[words.length - 1][0]}`;
  return letters.toUpperCase();
}

/**
 * Book cover with a 2:3 ratio and an initials fallback when there is no image or it fails.
 * A cover the app conceals (see `CoverPrivacy`) is blurred, with an eye that shows it.
 */
export function Cover({ src, title, size = "md", sheen = false, className }: CoverProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const privacy = useCoverPrivacy();
  const showImage = Boolean(src) && !failed;
  const concealed = showImage && privacy.isConcealed(src!);

  // Covers sit inside clickable cards and buttons: showing the image must not open the book.
  const reveal = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    privacy.reveal(src!);
  };

  return (
    <div className={cx("o-cover", `o-cover--${size}`, sheen && "o-cover--sheen", concealed && "is-concealed", className)} data-testid="cover">
      {showImage ? (
        <img
          className="o-cover__img"
          src={src ?? undefined}
          alt={concealed ? uiStrings.concealedCover(title) : title}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="o-cover__fallback" role="img" aria-label={title}>
          <span aria-hidden="true">{coverInitials(title)}</span>
        </span>
      )}
      {concealed ? (
        <span className="o-cover__veil" data-card-control>
          <span
            role="button"
            tabIndex={0}
            className="o-cover__reveal"
            aria-label={uiStrings.showCover(title)}
            title={uiStrings.showCoverHint}
            data-testid="cover-reveal"
            onClick={reveal}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") reveal(event);
            }}
          >
            <Eye aria-hidden="true" />
            {size === "sm" ? null : <span className="o-cover__reveal-text">{uiStrings.adultCover}</span>}
          </span>
        </span>
      ) : null}
    </div>
  );
}
