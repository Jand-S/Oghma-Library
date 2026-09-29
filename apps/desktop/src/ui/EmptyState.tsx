import type { ReactNode } from "react";
import { cx } from "./cx";
import "./EmptyState.css";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons or links shown under the text. */
  action?: ReactNode;
  /** Extra content, e.g. a monospace error detail. */
  children?: ReactNode;
  tone?: "neutral" | "danger";
  className?: string;
};

export function EmptyState({ icon, title, description, action, children, tone = "neutral", className }: EmptyStateProps) {
  return (
    <div className={cx("o-empty", `o-empty--${tone}`, className)}>
      {icon ? <span className="o-empty__icon" aria-hidden="true">{icon}</span> : null}
      <h2 className="o-empty__title">{title}</h2>
      {description ? <p className="o-empty__description">{description}</p> : null}
      {children}
      {action ? <div className="o-empty__actions">{action}</div> : null}
    </div>
  );
}
