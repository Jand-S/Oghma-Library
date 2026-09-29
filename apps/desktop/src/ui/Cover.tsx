import { useEffect, useState } from "react";
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

/** Book cover with a 2:3 ratio and an initials fallback when there is no image or it fails. */
export function Cover({ src, title, size = "md", sheen = false, className }: CoverProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const showImage = Boolean(src) && !failed;

  return (
    <div className={cx("o-cover", `o-cover--${size}`, sheen && "o-cover--sheen", className)} data-testid="cover">
      {showImage ? (
        <img className="o-cover__img" src={src ?? undefined} alt={title} loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <span className="o-cover__fallback" role="img" aria-label={title}>
          <span aria-hidden="true">{coverInitials(title)}</span>
        </span>
      )}
    </div>
  );
}
