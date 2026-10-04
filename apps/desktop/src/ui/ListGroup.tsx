import type { ReactNode } from "react";
import { cx } from "./cx";
import "./ListGroup.css";

export type ListGroupProps = {
  /** Optional caption above the group. */
  title?: ReactNode;
  /** Optional note under the group. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Apple-style inset grouped list: rounded surface, hairline separators between rows. */
export function ListGroup({ title, footer, children, className }: ListGroupProps) {
  return (
    <div className={cx("o-list-group", className)}>
      {title ? <h3 className="o-list-group__title">{title}</h3> : null}
      <div className="o-list-group__rows" role="list">{children}</div>
      {footer ? <p className="o-list-group__footer">{footer}</p> : null}
    </div>
  );
}

export type ListRowProps = {
  /** Leading icon or artwork. */
  icon?: ReactNode;
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  /** Trailing value or control. */
  children?: ReactNode;
  /** Stack the value under the label (long values such as paths). */
  stacked?: boolean;
  className?: string;
};

export function ListRow({ icon, label, description, children, stacked = false, className }: ListRowProps) {
  return (
    <div className={cx("o-list-row", stacked && "o-list-row--stacked", className)} role="listitem">
      {icon ? <span className="o-list-row__icon" aria-hidden="true">{icon}</span> : null}
      <div className="o-list-row__text">
        <span className="o-list-row__label">{label}</span>
        {description ? <span className="o-list-row__description">{description}</span> : null}
      </div>
      {children != null ? <div className="o-list-row__value">{children}</div> : null}
    </div>
  );
}
