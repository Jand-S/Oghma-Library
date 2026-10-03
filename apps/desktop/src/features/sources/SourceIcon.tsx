import { useState } from "react";
import { cx } from "../../ui";
import { sourceIconFor } from "./sourceIcons";
import "./SourceIcon.css";

export type SourceIconProps = {
  /** Source id ("central-novel"); used to find the bundled icon. */
  sourceId?: string | null;
  /** Site URL or domain; used when the id has no icon. */
  baseUrl?: string | null;
  /** Icon published with the index; used when there is no bundled file. */
  iconUrl?: string | null;
  /** Source name; its first letter is the fallback monogram. */
  name: string;
  /** sm = 20px (selects, badges), md = 24px, lg = 32px (Fontes list). */
  size?: "sm" | "md" | "lg";
  /** Grey monogram and faded icon, e.g. for a disabled source. */
  muted?: boolean;
  className?: string;
};

/**
 * A source's site icon: the files bundled in `public/sources/` first, then the icon the
 * server publishes in the index (new sources). Falls back to a monogram tile (first letter on an accent tint) when there is no file or it fails to load.
 * Decorative: the source name must be shown next to it.
 */
export function SourceIcon({ sourceId, baseUrl, iconUrl, name, size = "md", muted = false, className }: SourceIconProps) {
  const src = sourceIconFor({ id: sourceId, baseUrl }) ?? (iconUrl || null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const showImage = src !== null && failedSrc !== src;
  return (
    <span
      className={cx("sources-icon", `sources-icon--${size}`, showImage ? "sources-icon--image" : "sources-icon--monogram", muted && "sources-icon--muted", className)}
      data-testid="source-icon"
      data-fallback={showImage ? undefined : "monogram"}
      aria-hidden="true"
    >
      {showImage
        ? <img className="sources-icon__img" src={src} alt="" draggable={false} decoding="async" onError={() => setFailedSrc(src)} />
        : (name.trim().slice(0, 1) || "?").toUpperCase()}
    </span>
  );
}
