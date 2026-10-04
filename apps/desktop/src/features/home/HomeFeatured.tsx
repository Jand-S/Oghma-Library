import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react";
import type { Novel } from "../../core/types";
import { homeStrings } from "../../strings/home";
import { Button, Cover, IconButton, cx } from "../../ui";

/** Time each featured novel stays on screen. */
export const FEATURED_INTERVAL_MS = 8000;
/** Horizontal wheel distance (trackpad swipe) that turns the page. */
const WHEEL_STEP = 60;
/** After a wheel turn, ignore the rest of the same swipe (trackpad momentum). */
const WHEEL_COOLDOWN_MS = 650;
/** Mouse drag distance that turns the page. */
const DRAG_STEP = 50;

function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type HomeFeaturedProps = {
  novels: Novel[];
  /** "Para você" when the picks come from the library, "Destaque" otherwise. */
  eyebrow: string;
  onOpen: (novel: Novel) => void;
};

/**
 * Apple Books/TV-style hero: the cover blurred as the backdrop, the cover, title, facts and a
 * short synopsis. Rotates every 8 s (paused on hover/focus and with reduced motion).
 */
export function HomeFeatured({ novels, eyebrow, onOpen }: HomeFeaturedProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const [dragging, setDragging] = useState(false);
  const wheel = useRef({ acc: 0, lockedUntil: 0 });
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const count = novels.length;
  const current = novels[Math.min(index, count - 1)];

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), FEATURED_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  if (!current) return null;
  const go = (step: number) => {
    if (count < 2) return;
    setDirection(step > 0 ? "next" : "prev");
    setIndex((value) => (value + step + count) % count);
  };
  const jump = (target: number) => {
    if (target === index) return;
    setDirection(target > index ? "next" : "prev");
    setIndex(target);
  };

  // Trackpad two-finger swipe / horizontal wheel: one page per gesture.
  const onWheel = (event: WheelEvent<HTMLElement>) => {
    if (count < 2 || Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
    const now = Date.now();
    const state = wheel.current;
    if (now < state.lockedUntil) return;
    state.acc += event.deltaX;
    if (Math.abs(state.acc) < WHEEL_STEP) return;
    go(state.acc > 0 ? 1 : -1);
    state.acc = 0;
    state.lockedUntil = now + WHEEL_COOLDOWN_MS;
  };

  // Mouse drag (or touch swipe) across the hero.
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    if (count < 2 || event.button !== 0) return;
    if ((event.target as Element).closest(".home-hero__nav, .home-hero__actions")) return;
    drag.current = { x: event.clientX, moved: false };
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    if (!start) return;
    if (!start.moved && Math.abs(event.clientX - start.x) > 6) {
      start.moved = true;
      setDragging(true);
    }
  };
  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const start = drag.current;
    drag.current = null;
    setDragging(false);
    if (!start?.moved) return;
    const dx = event.clientX - start.x;
    if (Math.abs(dx) >= DRAG_STEP) {
      // The drag ended on the cover: do not also open it.
      suppressClick.current = true;
      go(dx < 0 ? 1 : -1);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
  };
  const open = (novel: Novel) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onOpen(novel);
  };
  const facts = [
    current.author,
    current.sourceName,
    homeStrings.chapters(current.chapters),
    current.status === "complete" ? homeStrings.complete : null
  ].filter(Boolean).join(" · ");
  const style = current.coverUrl ? ({ "--home-hero-image": `url("${current.coverUrl}")` } as CSSProperties) : undefined;

  return (
    <section
      className={cx("home-hero", current.coverUrl && "home-hero--image", dragging && "is-dragging")}
      style={style}
      aria-roledescription={homeStrings.featuredRole}
      aria-label={homeStrings.featured}
      data-testid="home-featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={onKeyDown}
    >
      <div className="home-hero__backdrop" aria-hidden="true" key={`bg-${current.id}`} />
      <div className={cx("home-hero__content", direction && `home-hero__content--${direction}`)} key={current.id}>
        <button type="button" className="home-hero__cover" onClick={() => open(current)} draggable={false} aria-label={homeStrings.openDetails(current.title)}>
          <Cover src={current.coverUrl} title={current.title} size="fill" sheen />
        </button>
        <div className="home-hero__info">
          <span className="home-hero__eyebrow">{eyebrow}</span>
          <h2 className="home-hero__title">{current.title}</h2>
          <p className="home-hero__facts">
            {facts}
            {current.rating ? (
              <span className="home-hero__rating"><Star aria-hidden="true" />{current.rating.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</span>
            ) : null}
          </p>
          {current.description ? <p className="home-hero__synopsis">{current.description}</p> : null}
          <div className="home-hero__actions">
            <Button variant="primary" onClick={() => open(current)} data-testid="home-featured-open">{homeStrings.details}</Button>
          </div>
        </div>
      </div>
      {count > 1 ? (
        <div className="home-hero__nav">
          <IconButton label={homeStrings.previous} icon={<ChevronLeft />} size="sm" variant="ghost" onClick={() => go(-1)} />
          <div className="home-hero__dots" role="group" aria-label={homeStrings.featured}>
            {novels.map((novel, i) => (
              <button
                key={novel.id}
                type="button"
                className={cx("home-hero__dot", i === index && "is-active")}
                aria-label={novel.title}
                aria-current={i === index ? "true" : undefined}
                onClick={() => jump(i)}
              />
            ))}
          </div>
          <IconButton label={homeStrings.next} icon={<ChevronRight />} size="sm" variant="ghost" onClick={() => go(1)} />
        </div>
      ) : null}
    </section>
  );
}
