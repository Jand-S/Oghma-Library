import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cx } from "./cx";
import "./SectionHeader.css";

export type SectionHeaderProps = {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Heading level; defaults to h2. */
  as?: "h2" | "h3";
  /** "lg" for page sections (shelves), "md" inside panels and side columns. */
  size?: "lg" | "md";
  id?: string;
  /** Trailing control, e.g. a button. Ignored when `onSeeAll` is set. */
  action?: ReactNode;
  /** Renders an accent "Ver tudo ›" link. */
  onSeeAll?: () => void;
  seeAllLabel?: string;
  className?: string;
};

/** The one section title style: sentence case, semibold, optional subtitle and trailing link. */
export function SectionHeader({ title, subtitle, as: Heading = "h2", size = "lg", id, action, onSeeAll, seeAllLabel = "Ver tudo", className }: SectionHeaderProps) {
  return (
    <header className={cx("o-section-header", `o-section-header--${size}`, className)}>
      <div className="o-section-header__text">
        <Heading className="o-section-header__title" id={id}>{title}</Heading>
        {subtitle ? <p className="o-section-header__subtitle">{subtitle}</p> : null}
      </div>
      {onSeeAll ? (
        <button type="button" className="o-section-header__link" onClick={onSeeAll}>
          {seeAllLabel}
          <ChevronRight aria-hidden="true" />
        </button>
      ) : action ? (
        <div className="o-section-header__action">{action}</div>
      ) : null}
    </header>
  );
}
