import { forwardRef, useMemo, type UIEventHandler } from "react";
import { cx } from "../../ui";
import { sanitizeHtml } from "./sanitizeHtml";

type ReaderProps = {
  html: string | null | undefined;
  label: string;
  lang?: string;
  className?: string;
  testId?: string;
  onScroll?: UIEventHandler<HTMLElement>;
  empty?: string;
};

/** Book text in reading typography (serif, ~70ch). The HTML is sanitized first. */
export const Reader = forwardRef<HTMLElement, ReaderProps>(function Reader({ html, label, lang, className, testId, onScroll, empty }, ref) {
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  return (
    <article
      ref={ref}
      className={cx("translation-reader", className)}
      aria-label={label}
      lang={lang}
      tabIndex={0}
      data-testid={testId}
      onScroll={onScroll}
    >
      {clean ? (
        <div className="translation-reader__text" dangerouslySetInnerHTML={{ __html: clean }} />
      ) : (
        <p className="translation-reader__empty">{empty}</p>
      )}
    </article>
  );
});
