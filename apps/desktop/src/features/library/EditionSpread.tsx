import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Badge, Cover, cx } from "../../ui";
import { formatSummary, isShelf } from "./libraryModel";
import { ReadingStatusLabel } from "./ReadingStatus";

type EditionSpreadProps = {
  /** The stack's cover: the editions come out of it and the panel opens around it. */
  anchor: HTMLElement;
  title: string;
  items: LibraryItem[];
  onPick: (item: LibraryItem) => void;
  onClose: () => void;
};

type Layout = { left: number; top: number; width: number; panel: number; from: { x: number; y: number }[] };

const GAP = 16;
const PAD_X = 16;
const PAD_TOP = 14;
const HEAD = 30;
const MAX_COVER = 168;
const EDGE = 16;
const CLOSE_MS = 220;

/** Where each edition card goes, and where it starts (on the stack) for the opening animation. */
function layoutFor(anchor: HTMLElement, count: number): Layout {
  const media = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;
  const fit = (vw - EDGE * 2 - PAD_X * 2 - GAP * (count - 1)) / count;
  const width = Math.max(96, Math.min(media.width * 1.04, MAX_COVER, fit));
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

function editionLabel(item: LibraryItem) {
  if (item.language) return libraryStrings.translationEdition(item.language.toUpperCase());
  return item.sourceName ?? libraryStrings.localSource;
}

/**
 * The editions of a stack, spread over the grid out of the stack itself (like a Dock stack).
 * Nothing in the grid moves; a click outside, Esc, scrolling or resizing folds them back.
 */
export function EditionSpread({ anchor, title, items, onPick, onClose }: EditionSpreadProps) {
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
      else anchor.closest<HTMLElement>("[data-testid=library-card]")?.focus({ preventScroll: true });
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
    // Any scroll (the library scrolls inside its own container) folds the editions back.
    window.addEventListener("scroll", fold, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", fold);
      window.removeEventListener("scroll", fold, true);
    };
  }, []);

  if (!layout) return null;
  const panelStyle = { left: layout.left, top: layout.top, width: layout.panel, "--edition-width": `${layout.width}px` } as CSSProperties;

  return createPortal(
    <>
      <div className={cx("edition-scrim", phase === "closing" && "is-closing")} onClick={() => close()} aria-hidden="true" />
      <div
        ref={panelRef}
        className={cx("edition-spread", phase === "open" && "is-open", phase === "closing" && "is-closing")}
        style={panelStyle}
        role="dialog"
        aria-label={libraryStrings.editionsOf(title, items.length)}
        data-testid="edition-spread"
      >
        <div className="edition-spread__head" title={libraryStrings.editionsHint}>
          <strong>{title}</strong>
          <span>{libraryStrings.editionsCount(items.length)}</span>
        </div>
        <ul className="edition-spread__row">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                className="edition-spread__item"
                style={{ "--i": index, "--fx": `${layout.from[index].x}px`, "--fy": `${layout.from[index].y}px` } as CSSProperties}
                onClick={() => close(() => onPick(item))}
                data-testid="edition-spread-item"
              >
                <Cover src={item.coverUrl} title={item.title} size="fill" sheen className="edition-spread__cover" />
                <span className="edition-spread__label">{editionLabel(item)}</span>
                <span className="edition-spread__meta">
                  {isShelf(item)
                    ? <Badge>{libraryStrings.onShelfBadge}</Badge>
                    : <Badge tone="accent">{formatSummary(item)}</Badge>}
                </span>
                <ReadingStatusLabel status={item.readingStatus} />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>,
    document.body
  );
}
