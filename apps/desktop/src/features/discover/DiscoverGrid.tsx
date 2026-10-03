import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Novel } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Button, Cover, SelectionMark, Skeleton, cx } from "../../ui";

/** Cards rendered per batch; "Mostrar mais" (or scrolling to the end) adds another batch. */
export const DISCOVER_PAGE_SIZE = 60;

type DiscoverGridProps = {
  novels: Novel[];
  total: number;
  visibleCount: number;
  selectedId?: string;
  detailId?: string;
  scrollRoot: RefObject<HTMLElement | null>;
  onShowMore: () => void;
  onSelect: (novel: Novel) => void;
  onPreview: (novel: Novel) => void;
};

/** Number of cards on the first row, i.e. the current column count. */
function columnCount(hits: HTMLElement[]) {
  const firstTop = hits[0]?.parentElement?.offsetTop ?? 0;
  const sameRow = hits.findIndex((hit) => (hit.parentElement?.offsetTop ?? 0) !== firstTop);
  return sameRow === -1 ? hits.length : Math.max(1, sameRow);
}

export function DiscoverGrid({
  novels,
  total,
  visibleCount,
  selectedId,
  detailId,
  scrollRoot,
  onShowMore,
  onSelect,
  onPreview
}: DiscoverGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const hasMore = visibleCount < total;

  useEffect(() => {
    if (activeIndex >= novels.length) setActiveIndex(0);
  }, [activeIndex, novels.length]);

  // Infinite scroll: load the next batch when the footer gets close to the viewport.
  // Re-observing after each batch re-checks a sentinel that is still visible.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!hasMore || !sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onShowMore();
      },
      { root: scrollRoot.current, rootMargin: "0px 0px 480px 0px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, onShowMore, scrollRoot, visibleCount]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (!target.matches("[data-card-hit]")) return;
    const hits = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-card-hit]") ?? []);
    const index = hits.indexOf(target);
    if (index === -1) return;
    const columns = columnCount(hits);
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      ArrowDown: index + columns,
      ArrowUp: index - columns,
      Home: 0,
      End: hits.length - 1
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const clamped = Math.max(0, Math.min(hits.length - 1, next));
    hits[clamped]?.focus();
    hits[clamped]?.scrollIntoView?.({ block: "nearest" });
  };

  return (
    <>
      <div className="discover-grid" data-testid="book-grid" ref={gridRef} role="list" onKeyDown={onKeyDown}>
        {novels.map((novel, index) => (
          <NovelCard
            key={novel.id}
            novel={novel}
            selected={novel.id === selectedId}
            focused={novel.id === detailId}
            tabbable={index === activeIndex}
            onFocus={() => setActiveIndex(index)}
            onSelect={() => onSelect(novel)}
            onPreview={() => onPreview(novel)}
          />
        ))}
      </div>
      {hasMore ? (
        <div className="discover-more" ref={sentinelRef}>
          <span className="discover-more__count">{discoverStrings.resultCount(visibleCount, total)}</span>
          <Button variant="outline" onClick={onShowMore}>{discoverStrings.showMore}</Button>
        </div>
      ) : null}
    </>
  );
}

function NovelCard({
  novel,
  selected,
  focused,
  tabbable,
  onFocus,
  onSelect,
  onPreview
}: {
  novel: Novel;
  selected: boolean;
  focused: boolean;
  tabbable: boolean;
  onFocus: () => void;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    onPreview();
  };

  return (
    // The whole card is clickable; the overlay button gives keyboard and screen-reader access
    // and its click bubbles here, so selection happens exactly once.
    <article
      className={cx("discover-card", selected && "is-selected", focused && !selected && "is-focused")}
      data-testid="book-card"
      data-discover-card=""
      role="listitem"
      onClick={onSelect}
      onContextMenu={onContextMenu}
    >
      <div className="discover-card__media">
        <Cover src={novel.coverUrl} title={novel.title} size="fill" sheen className="discover-card__cover" />
        {selected ? <SelectionMark /> : null}
      </div>
      <div className="discover-card__body">
        <strong className="discover-card__title" data-testid="card-title" title={novel.title}>{novel.title}</strong>
        <span className="discover-card__meta">
          <span className="discover-card__source">{novel.sourceName}</span>
          <span aria-hidden="true">·</span>
          <span>{novel.sourceChapters ? discoverStrings.chaptersShortOf(novel.chapters, novel.sourceChapters) : discoverStrings.chaptersShort(novel.chapters)}</span>
        </span>
        {novel.status === "complete" || novel.rating ? (
          <span className="discover-card__facts">
            {novel.status === "complete" ? <span className="discover-card__complete">{discoverStrings.completeShort}</span> : null}
            {novel.rating ? <span aria-label={discoverStrings.ratingLabel(novel.rating, novel.ratingVotes)}>{discoverStrings.rating(novel.rating)}</span> : null}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="discover-card__hit"
        data-card-hit=""
        data-testid="card-select"
        tabIndex={tabbable ? 0 : -1}
        aria-label={selected ? discoverStrings.removeFromQueue(novel.title) : discoverStrings.selectForQueue(novel.title)}
        onFocus={onFocus}
      />
    </article>
  );
}

export function DiscoverGridSkeleton() {
  return (
    <div className="discover-grid" aria-busy="true">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="discover-card discover-card--skeleton" key={index} aria-hidden="true">
          <Skeleton className="discover-card__skeleton-cover" height="auto" radius="var(--radius-sm)" />
          <Skeleton height="var(--fs-md)" width="80%" />
          <Skeleton height="var(--fs-xs)" width="50%" />
        </div>
      ))}
    </div>
  );
}
