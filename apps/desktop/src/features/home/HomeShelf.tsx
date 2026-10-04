import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { homeStrings } from "../../strings/home";
import { Cover, SectionHeader, cx } from "../../ui";

type HomeShelfProps = {
  id: string;
  title: string;
  subtitle?: string;
  onSeeAll?: () => void;
  /** "wide" rows hold horizontal book cards (Continue lendo); "tiles" hold covers. */
  variant?: "tiles" | "wide";
  children: ReactNode;
};

/** A titled horizontal row with hidden scrollbar, edge fades and ‹ › buttons on hover. */
export function HomeShelf({ id, title, subtitle, onSeeAll, variant = "tiles", children }: HomeShelfProps) {
  const rowRef = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const row = rowRef.current;
    if (!row) return;
    const start = row.scrollLeft > 1;
    const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
    setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  useEffect(() => {
    measure();
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [measure, children]);

  const page = (direction: 1 | -1) => {
    const row = rowRef.current;
    if (row) row.scrollBy({ left: direction * row.clientWidth * 0.85, behavior: "smooth" });
  };

  return (
    <section className={cx("home-shelf", `home-shelf--${variant}`)} aria-labelledby={`home-${id}`} data-testid={`home-shelf-${id}`}>
      <SectionHeader id={`home-${id}`} title={title} subtitle={subtitle} onSeeAll={onSeeAll} seeAllLabel={homeStrings.seeAll} />
      <div className={cx("home-shelf__viewport", edges.start && "can-scroll-start", edges.end && "can-scroll-end")}>
        <ul className="home-shelf__row" ref={rowRef} onScroll={measure}>
          {children}
        </ul>
        {edges.start ? (
          <button type="button" className="home-shelf__arrow home-shelf__arrow--start" aria-label={homeStrings.scrollBack} onClick={() => page(-1)}>
            <ChevronLeft aria-hidden="true" />
          </button>
        ) : null}
        {edges.end ? (
          <button type="button" className="home-shelf__arrow home-shelf__arrow--end" aria-label={homeStrings.scrollForward} onClick={() => page(1)}>
            <ChevronRight aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** Cover tile: cover, two-line title, one meta line. */
export function HomeTile({ title, cover, meta, accent = false, onClick }: { title: string; cover?: string; meta?: string; accent?: boolean; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="home-tile" onClick={onClick} title={title}>
        <Cover src={cover} title={title} size="fill" sheen className="home-tile__cover" />
        <span className="home-tile__title">{title}</span>
        {meta ? <span className={cx("home-tile__meta", accent && "home-tile__meta--accent")}>{meta}</span> : null}
      </button>
    </li>
  );
}

/** Wide card for library books: small cover, title, source and the new-chapters count. */
export function HomeBookCard({ title, cover, meta, accent, onClick }: { title: string; cover?: string; meta?: string; accent?: string; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="home-book" onClick={onClick} title={title}>
        <Cover src={cover} title={title} size="fill" className="home-book__cover" />
        <span className="home-book__text">
          <span className="home-book__title">{title}</span>
          {meta ? <span className="home-book__meta">{meta}</span> : null}
          {accent ? <span className="home-book__accent">{accent}</span> : null}
        </span>
      </button>
    </li>
  );
}
