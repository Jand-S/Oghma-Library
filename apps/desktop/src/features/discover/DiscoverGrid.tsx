import { Layers } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import type { Novel } from "../../core/types";
import type { NovelStack } from "../../services/catalogIndex";
import { discoverStrings } from "../../strings/discover";
import { Button, Cover, SelectionMark, Skeleton, StackSpread, cx } from "../../ui";

/** Cards rendered per batch; "Mostrar mais" (or scrolling to the end) adds another batch. */
export const DISCOVER_PAGE_SIZE = 60;

type DiscoverGridProps = {
  novels: Novel[];
  /** The same work from several sources as one card (see `stackNovels`); `novels` is ignored then. */
  stacks?: NovelStack[] | null;
  total: number;
  visibleCount: number;
  selectedId?: string;
  detailId?: string;
  scrollRoot: RefObject<HTMLElement | null>;
  onShowMore: () => void;
  onSelect: (novel: Novel) => void;
  onPreview: (novel: Novel) => void;
  /** Filtro inteligente: why each novel is here ("Em comum com X: ..."). */
  reasons?: Record<string, string>;
};

/** Number of cards on the first row, i.e. the current column count. */
function columnCount(hits: HTMLElement[]) {
  const firstTop = hits[0]?.parentElement?.offsetTop ?? 0;
  const sameRow = hits.findIndex((hit) => (hit.parentElement?.offsetTop ?? 0) !== firstTop);
  return sameRow === -1 ? hits.length : Math.max(1, sameRow);
}

export function DiscoverGrid({
  novels,
  stacks,
  total,
  visibleCount,
  selectedId,
  detailId,
  scrollRoot,
  onShowMore,
  onSelect,
  onPreview,
  reasons
}: DiscoverGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [spread, setSpread] = useState<{ stack: NovelStack; anchor: HTMLElement; card: HTMLElement | null } | null>(null);
  const hasMore = visibleCount < total;
  const cards: NovelStack[] = stacks ?? novels.map((novel) => ({ key: novel.id, main: novel, items: [novel] }));

  useEffect(() => {
    if (activeIndex >= cards.length) setActiveIndex(0);
  }, [activeIndex, cards.length]);

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
        {cards.map((stack, index) => {
          const novel = stack.main;
          const editions = stack.items.length;
          return (
            <NovelCard
              key={stack.key}
              novel={novel}
              novelIds={stack.items.map((item) => item.id).join(" ")}
              editions={editions}
              reason={reasons?.[novel.id]}
              selected={stack.items.some((item) => item.id === selectedId)}
              focused={stack.items.some((item) => item.id === detailId)}
              spread={spread?.stack.key === stack.key}
              tabbable={index === activeIndex}
              onFocus={() => setActiveIndex(index)}
              onSelect={(card) => {
                if (editions < 2) return onSelect(novel);
                const anchor = card.querySelector<HTMLElement>(".discover-card__media");
                if (anchor) setSpread({ stack, anchor, card: card.querySelector<HTMLElement>("[data-card-hit]") });
              }}
              onPreview={() => onPreview(novel)}
            />
          );
        })}
      </div>
      {spread ? (
        <StackSpread
          anchor={spread.anchor}
          title={spread.stack.main.title}
          count={discoverStrings.sourcesCount(spread.stack.items.length)}
          items={spread.stack.items}
          itemKey={(novel) => novel.id}
          card={(novel) => ({
            cover: novel.coverUrl,
            title: novel.title,
            label: novel.sourceName,
            meta: (
              <>
                <span>{novel.sourceChapters ? discoverStrings.chaptersShortOf(novel.chapters, novel.sourceChapters) : discoverStrings.chaptersShort(novel.chapters)}</span>
                {novel.status === "complete" ? <span className="discover-card__complete">{discoverStrings.completeShort}</span> : null}
                {novel.language && novel.language !== "pt-BR" ? <span>{novel.language.toUpperCase()}</span> : null}
              </>
            )
          })}
          onPick={onSelect}
          onClose={() => setSpread(null)}
          returnFocus={spread.card}
          data-testid="discover-stack-spread"
        />
      ) : null}
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
  novelIds,
  editions,
  selected,
  focused,
  spread,
  tabbable,
  onFocus,
  onSelect,
  onPreview,
  reason
}: {
  reason?: string;
  novel: Novel;
  /** Every novel this card stands for (a stack has several), space separated: the page finds the card of the open novel by it. */
  novelIds: string;
  /** More than 1: the same work from several sources (a stack). */
  editions: number;
  selected: boolean;
  focused: boolean;
  /** Its editions are spread over the grid right now. */
  spread: boolean;
  tabbable: boolean;
  onFocus: () => void;
  onSelect: (card: HTMLElement) => void;
  onPreview: () => void;
}) {
  const stack = editions > 1;
  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    onPreview();
  };

  return (
    // The whole card is clickable; the overlay button gives keyboard and screen-reader access
    // and its click bubbles here, so selection happens exactly once.
    <article
      className={cx(
        "discover-card",
        selected && "is-selected",
        focused && !selected && "is-focused",
        stack && "is-stack",
        editions > 2 && "is-stack-deep",
        spread && "is-spread"
      )}
      data-testid="book-card"
      data-discover-card=""
      data-novel-ids={novelIds}
      data-editions={stack ? editions : undefined}
      role="listitem"
      onClick={(event) => onSelect(event.currentTarget)}
      onContextMenu={onContextMenu}
    >
      <div className="discover-card__media">
        <Cover src={novel.coverUrl} title={novel.title} size="fill" sheen className="discover-card__cover" />
        {stack ? (
          <span className="o-stack-count" data-testid="discover-stack-count">
            <Layers aria-hidden="true" />
            {discoverStrings.sourcesCount(editions)}
          </span>
        ) : null}
        {selected ? <SelectionMark /> : null}
      </div>
      <div className="discover-card__body">
        <strong className="discover-card__title" data-testid="card-title" title={novel.title}>{novel.title}</strong>
        <span className="discover-card__meta">
          <span className="discover-card__source">{stack ? discoverStrings.sourcesCount(editions) : novel.sourceName}</span>
          <span aria-hidden="true">·</span>
          <span>{novel.sourceChapters ? discoverStrings.chaptersShortOf(novel.chapters, novel.sourceChapters) : discoverStrings.chaptersShort(novel.chapters)}</span>
        </span>
        {reason ? <span className="discover-card__reason" title={reason}>{reason}</span> : null}
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
        aria-label={stack
          ? discoverStrings.showSources(novel.title, editions)
          : selected ? discoverStrings.removeFromQueue(novel.title) : discoverStrings.selectForQueue(novel.title)}
        aria-haspopup={stack ? "dialog" : undefined}
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
