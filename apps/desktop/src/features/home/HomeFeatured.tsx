import { ChevronLeft, ChevronRight, Star } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import type { Novel } from "../../core/types";
import { homeStrings } from "../../strings/home";
import { Button, Cover, IconButton, cx } from "../../ui";

/** Time each featured novel stays on screen. */
export const FEATURED_INTERVAL_MS = 8000;

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
  const count = novels.length;
  const current = novels[Math.min(index, count - 1)];

  useEffect(() => {
    if (count < 2 || paused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % count), FEATURED_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [count, paused]);

  if (!current) return null;
  const go = (step: number) => setIndex((value) => (value + step + count) % count);
  const facts = [
    current.author,
    current.sourceName,
    homeStrings.chapters(current.chapters),
    current.status === "complete" ? homeStrings.complete : null
  ].filter(Boolean).join(" · ");
  const style = current.coverUrl ? ({ "--home-hero-image": `url("${current.coverUrl}")` } as CSSProperties) : undefined;

  return (
    <section
      className={cx("home-hero", current.coverUrl && "home-hero--image")}
      style={style}
      aria-roledescription={homeStrings.featuredRole}
      aria-label={homeStrings.featured}
      data-testid="home-featured"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="home-hero__backdrop" aria-hidden="true" key={`bg-${current.id}`} />
      <div className="home-hero__content" key={current.id}>
        <button type="button" className="home-hero__cover" onClick={() => onOpen(current)} aria-label={homeStrings.openDetails(current.title)}>
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
            <Button variant="primary" onClick={() => onOpen(current)} data-testid="home-featured-open">{homeStrings.details}</Button>
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
                onClick={() => setIndex(i)}
              />
            ))}
          </div>
          <IconButton label={homeStrings.next} icon={<ChevronRight />} size="sm" variant="ghost" onClick={() => go(1)} />
        </div>
      ) : null}
    </section>
  );
}
