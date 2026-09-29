import { useId, type ReactNode } from "react";
import { cx } from "./cx";
import "./Panel.css";

type BlockProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

function BlockHeader({ id, title, description, actions, prefix }: BlockProps & { id: string; prefix: string }) {
  if (!title && !description && !actions) return null;
  return (
    <header className={`${prefix}__header`}>
      <div className={`${prefix}__heading`}>
        {title ? <h2 className={`${prefix}__title`} id={id}>{title}</h2> : null}
        {description ? <p className={`${prefix}__description`}>{description}</p> : null}
      </div>
      {actions ? <div className={`${prefix}__actions`}>{actions}</div> : null}
    </header>
  );
}

/** A surface card grouping related content. */
export function Panel({ title, description, actions, children, className, glass = false }: BlockProps & { glass?: boolean }) {
  const id = useId();
  return (
    <section className={cx("o-panel", glass && "o-panel--glass", className)} aria-labelledby={title ? id : undefined}>
      <BlockHeader id={id} prefix="o-panel" title={title} description={description} actions={actions} />
      {children != null ? <div className="o-panel__body">{children}</div> : null}
    </section>
  );
}

/** A titled group without a surface, for page sections. */
export function Section({ title, description, actions, children, className }: BlockProps) {
  const id = useId();
  return (
    <section className={cx("o-section", className)} aria-labelledby={title ? id : undefined}>
      <BlockHeader id={id} prefix="o-section" title={title} description={description} actions={actions} />
      {children}
    </section>
  );
}
