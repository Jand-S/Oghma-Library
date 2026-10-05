import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Cover } from "./Cover";
import { cx } from "./cx";
import "./StackSpread.css";

/** What one card of the spread shows: its cover, a label line and an optional extra line. */
export type StackSpreadCard = { cover?: string | null; title: string; label: ReactNode; meta?: ReactNode };

export type StackSpreadProps<T> = {
  /** The stack's cover: the cards come out of it and the panel opens around it. */
  anchor: HTMLElement;
  /** Heading: the work's name and how many cards ("Lord of Mysteries · 3 edições"). */
  title: string;
  count: string;
  items: T[];
  itemKey: (item: T) => string;
  card: (item: T) => StackSpreadCard;
  onPick: (item: T) => void;
  onClose: () => void;
  /** Focus goes back here when the spread folds without a pick (the stack card). */
  returnFocus?: HTMLElement | null;
  "data-testid"?: string;
};

type Layout = { left: number; top: number; width: number; panel: number; from: { x: number; y: number }[] };

const GAP = 16;
const PAD_X = 16;
const PAD_TOP = 14;
const HEAD = 30;
const MAX_COVER = 168;
const MIN_COVER = 96;
const EDGE = 16;
const CLOSE_MS = 220;

/** Where each card goes, and where it starts (on the stack) for the opening animation. */
function layoutFor(anchor: HTMLElement, count: number): Layout {
  const media = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const fit = (vw - EDGE * 2 - PAD_X * 2 - GAP * (count - 1)) / count;
  const width = Math.max(MIN_COVER, Math.min(media.width * 1.04, MAX_COVER, fit));
  const inner = count * width + (count - 1) * GAP;
  const total = inner + PAD_X * 2;
  const height = PAD_TOP + HEAD + width * 1.5 + 72;
  const left = Math.max(EDGE, Math.min(media.left - PAD_X - (inner - media.width) / 2, vw - total - EDGE));
  const top = Math.max(EDGE, Math.min(media.top - PAD_TOP - HEAD, vh - height - EDGE));
  const from = Array.from({ length: count }, (_, index) => ({
    x: media.left - (left + PAD_X + index * (width + GAP)),
    y: media.top - (top + PAD_TOP + HEAD)
  }));
  return { left, top, width, panel: total, from };
}

/**
 * The cards of a stack (editions of one work), spread over the page out of the stack itself,
 * like a Dock stack. Nothing behind moves; a click outside, Esc, scrolling or resizing folds
 * them back.
 */
export function StackSpread<T>({ anchor, title, count, items, itemKey, card, onPick, onClose, returnFocus, ...rest }: StackSpreadProps<T>) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const panelRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);

  useLayoutEffect(() => setLayout(layoutFor(anchor, items.length)), [anchor, items.length]);

  // Two frames: the cards render on the stack first, then move out.
  useEffect(() => {
    if (!layout) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setPhase("open"));
    });
    panelRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [layout]);

  const close = (then?: () => void) => {
    if (closingRef.current) return;
    closingRef.current = true;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      onClose();
      if (then) then();
      else returnFocus?.focus({ preventScroll: true });
    };
    if (then || reduced) return finish();
    setPhase("closing");
    window.setTimeout(finish, CLOSE_MS);
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      closeRef.current();
    };
    const fold = () => closeRef.current(() => undefined);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", fold);
    // Any scroll (pages scroll inside their own containers) folds the cards back.
    window.addEventListener("scroll", fold, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", fold);
      window.removeEventListener("scroll", fold, true);
    };
  }, []);

  if (!layout) return null;
  const panelStyle = { left: layout.left, top: layout.top, width: layout.panel, "--stack-card-width": `${layout.width}px` } as CSSProperties;

  return createPortal(
    <>
      <div className={cx("o-stack-scrim", phase === "closing" && "is-closing")} onClick={() => close()} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cx("o-stack-spread", phase === "open" && "is-open", phase === "closing" && "is-closing")}
        style={panelStyle}
        role="dialog"
        aria-label={`${title}: ${count}`}
        data-testid={rest["data-testid"]}
      >
        <div className="o-stack-spread__head">
          <strong>{title}</strong>
          <span>{count}</span>
        </div>
        <ul className="o-stack-spread__row">
          {items.map((item, index) => {
            const view = card(item);
            return (
              <li key={itemKey(item)}>
                <button
                  type="button"
                  className="o-stack-spread__item"
                  style={{ "--i": index, "--fx": `${layout.from[index].x}px`, "--fy": `${layout.from[index].y}px` } as CSSProperties}
                  onClick={() => close(() => onPick(item))}
                  data-testid="stack-spread-item"
                >
                  <Cover src={view.cover} title={view.title} size="fill" sheen className="o-stack-spread__cover" />
                  <span className="o-stack-spread__label">{view.label}</span>
                  {view.meta ? <span className="o-stack-spread__meta">{view.meta}</span> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </>,
    document.body
  );
}
