import { CloudOff, RefreshCcw, SearchX, Settings, Globe2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, useLayoutEffect } from "react";
import type { ChapterSelection, Filters, Novel, SourceSite, TagCatalogItem } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Button, EmptyState, cx } from "../../ui";
import { DiscoverDetailPanel, type DiscoverShelf } from "./DiscoverDetailPanel";
import { DiscoverFilterBar } from "./DiscoverFilters";
import { DISCOVER_PAGE_SIZE, DiscoverGrid, DiscoverGridSkeleton } from "./DiscoverGrid";
import type { SortDirection } from "./DiscoverHeader";
import { sortNovels, stackNovels, withEditions, type CatalogIndex } from "../../services/catalogIndex";
import type { SmartResult } from "../../services/smartFilter";
import { SmartFilterStatus, type SmartStageInfo } from "./SmartFilterStatus";
import { activeFilters, clearedFilters } from "./filterModel";
import "./discover.css";

export type DiscoverViewProps = {
  sources: SourceSite[];
  filters: Filters;
  tagCatalog: TagCatalogItem[];
  results: Novel[];
  /** The same work from several sources as one card (needs the catalog index for synopsis matches). */
  stacks?: boolean;
  catalogIndex?: CatalogIndex | null;
  /** The single selected book (the configurator applies to it). */
  selectedNovel?: Novel;
  selection: ChapterSelection | null;
  loading: boolean;
  /** Message of the last failed search (backend offline), if any. */
  searchError: string | null;
  /** Book shown in the detail panel: the preview if there is one, else the selection. */
  detailNovel?: Novel;
  detailFromPreview: boolean;
  /** Title order of the grid (the sort toggle lives in the PageHeader). */
  sortDirection: SortDirection;
  adding: boolean;
  selectedInLibrary: boolean;
  selectedQueued: boolean;
  onFiltersChange: (filters: Filters) => void;
  /** Selects the book, or clears the selection when it is already selected. */
  onSelectNovel: (novel: Novel) => void;
  onClearSelection: () => void;
  /** Other editions and similar novels of the novel in the details panel. */
  related?: { editions: Novel[]; similar: Novel[] };
  /** Filtro inteligente: last result (order and reasons), busy flag and actions. */
  smart?: SmartResult | null;
  smartBusy?: boolean;
  /** What the smart filter is doing while busy (shown under the field). */
  smartStage?: SmartStageInfo | null;
  onClearSmart?: () => void;
  onPreviewNovel: (novel: Novel) => void;
  onClearPreview: () => void;
  onSelectionChange: (selection: ChapterSelection) => void;
  onAddSelected: () => void;
  onRetrySearch: () => void;
  onOpenSources: () => void;
  onOpenSettings: () => void;
  /** Library actions for the open novel (add to shelf, "Já li", rating). */
  shelf?: DiscoverShelf;
};

/** Controls a background click must never dismiss the preview from (filter popovers included). */
const INTERACTIVE = "[data-discover-card], [data-discover-popover], button, a, input, select, textarea, label, [role='radiogroup']";
/** Clicking text (headings, captions) is not a "background" click either. */
const TEXT_TAGS = new Set(["H1", "H2", "H3", "P", "SPAN", "STRONG", "SMALL", "SVG", "PATH", "IMG"]);

export function DiscoverView({
  sources,
  filters,
  tagCatalog,
  results: allResults,
  stacks: stacksOn = false,
  catalogIndex = null,
  selectedNovel,
  selection,
  loading,
  searchError,
  detailNovel,
  detailFromPreview,
  sortDirection,
  adding,
  selectedInLibrary,
  selectedQueued,
  onFiltersChange,
  onSelectNovel,
  onClearSelection,
  onPreviewNovel,
  related,
  smart = null,
  smartBusy = false,
  smartStage = null,
  onClearSmart,
  onClearPreview,
  onSelectionChange,
  onAddSelected,
  onRetrySearch,
  onOpenSources,
  onOpenSettings,
  shelf
}: DiscoverViewProps) {
  const [visibleCount, setVisibleCount] = useState(DISCOVER_PAGE_SIZE);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Opening or closing the details panel changes the grid's column count, so every card moves.
  // The card you clicked (or the one of the open novel) keeps its place on screen: its offset
  // from the top is noted before the change and the scroll is corrected right after it.
  const anchorRef = useRef<{ id: string; offset: number } | null>(null);
  const cardOf = useCallback((id: string) => {
    const root = scrollRef.current;
    if (!root) return null;
    return Array.from(root.querySelectorAll<HTMLElement>("[data-novel-ids]"))
      .find((card) => (card.dataset.novelIds ?? "").split(" ").includes(id)) ?? null;
  }, []);
  const noteAnchor = useCallback((id: string, card?: HTMLElement | null) => {
    const root = scrollRef.current;
    const element = card ?? cardOf(id);
    if (!root || !element) return;
    anchorRef.current = { id, offset: element.getBoundingClientRect().top - root.getBoundingClientRect().top };
  }, [cardOf]);
  const detailOpen = Boolean(detailNovel);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    const anchor = anchorRef.current;
    if (!root || !anchor) return;
    const card = cardOf(detailNovel?.id ?? anchor.id) ?? cardOf(anchor.id);
    if (!card) return;
    root.scrollTop += card.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset;
    noteAnchor(detailNovel?.id ?? anchor.id, card);
    // Only the open/close of the panel reflows the grid (the other values are read, not watched).
  }, [detailOpen]);
  // While the panel is open, keep the note fresh (you may scroll before closing it).
  useEffect(() => {
    if (detailNovel) noteAnchor(detailNovel.id);
  }, [detailNovel, noteAnchor]);

  // Curated smart filter: only the novels the model kept after reading the synopses, unless
  // the user asks to also see the ones that only share tags.
  const [smartBroad, setSmartBroad] = useState(false);
  useEffect(() => setSmartBroad(false), [smart]);
  const curated = Boolean(smart?.picks) && !smartBroad;
  // The picks are shown as they are: they were chosen under the request's filters already, and
  // intersecting with the grid search hid them whenever the two disagreed.
  const results = curated ? smart?.pickNovels ?? [] : allResults;
  // Editing a filter while curated means "show me the list with this filter": go broad.
  const changeFilters = (next: Filters) => {
    if (curated) setSmartBroad(true);
    onFiltersChange(next);
  };
  const [scrolled, setScrolled] = useState(false);

  // Back to the first batch only when the set of novels (or the order) really changes.
  const resultsKey = useMemo(() => results.map((novel) => novel.id).join("\n"), [results]);
  useEffect(() => setVisibleCount(DISCOVER_PAGE_SIZE), [resultsKey, sortDirection]);

  const ranked = filters.query.trim().length > 0;
  const sortedResults = useMemo(() => {
    // With a query the backend ranks by relevance (title > tag > author > synopsis).
    if (ranked) return results;
    if (smart) {
      // Filtro inteligente: closest to the reference (and best rated) first.
      return [...results].sort((a, b) => (smart.scores[b.id] ?? 0) - (smart.scores[a.id] ?? 0));
    }
    if (sortDirection === "asc" || sortDirection === "desc") return sortNovels(results, "title", sortDirection);
    return sortNovels(results, sortDirection);
  }, [results, sortDirection, ranked, smart]);
  // Stacks are paged like cards: a batch is 60 works, not 60 novels.
  // A text search brings the other editions of each match into its stack (they miss the text).
  const stacks = useMemo(() => {
    if (!stacksOn) return null;
    const list = ranked && !curated ? withEditions(sortedResults, catalogIndex, filters, filters.sourceIds) : sortedResults;
    return stackNovels(list, catalogIndex);
  }, [catalogIndex, curated, filters, ranked, sortedResults, stacksOn]);
  const cardCount = stacks ? stacks.length : sortedResults.length;
  const visibleResults = sortedResults.slice(0, visibleCount);
  const visibleStacks = stacks ? stacks.slice(0, visibleCount) : null;
  const showMore = useCallback(
    () => setVisibleCount((count) => Math.min(count + DISCOVER_PAGE_SIZE, cardCount)),
    [cardCount]
  );

  const enabledSources = sources.filter((source) => source.enabled);
  const currentSource = enabledSources.find((source) => source.id === filters.sourceId);
  const clearable = activeFilters(filters, tagCatalog).length > 0;
  const clearFilters = () => onFiltersChange(clearedFilters(filters));
  const showFilterBar = enabledSources.length > 0;

  // Esc closes the preview first, then the selected book's panel. Modals handle their own Esc.
  const hasDetail = Boolean(detailNovel);
  useEffect(() => {
    if (!hasDetail) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[aria-modal='true']")) return;
      event.preventDefault();
      if (detailFromPreview) onClearPreview();
      else onClearSelection();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailFromPreview, hasDetail, onClearPreview, onClearSelection]);

  /** A click on empty space around the results dismisses a temporary preview. */
  const onBackgroundClick = (event: MouseEvent<HTMLElement>) => {
    if (!detailFromPreview) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (target.closest(INTERACTIVE) || TEXT_TAGS.has(target.tagName.toUpperCase())) return;
    onClearPreview();
  };

  const closeDetail = () => (detailFromPreview ? onClearPreview() : onClearSelection());

  let content;
  if (enabledSources.length === 0 && !loading) {
    content = (
      <EmptyState
        icon={<Globe2 />}
        title={discoverStrings.noSourcesTitle}
        description={discoverStrings.noSourcesDescription}
        action={<Button variant="primary" onClick={onOpenSources}>{discoverStrings.openSources}</Button>}
      />
    );
  } else if (loading) {
    content = <DiscoverGridSkeleton />;
  } else if (searchError) {
    content = (
      <EmptyState
        tone="danger"
        icon={<CloudOff />}
        title={discoverStrings.offlineTitle}
        description={discoverStrings.offlineDescription}
        action={(
          <>
            <Button variant="primary" icon={<RefreshCcw />} onClick={onRetrySearch}>{discoverStrings.retry}</Button>
            <Button variant="outline" icon={<Settings />} onClick={onOpenSettings}>{discoverStrings.openSettings}</Button>
          </>
        )}
      />
    );
  } else if (results.length === 0 && !clearable && currentSource && currentSource.count === 0) {
    content = (
      <EmptyState
        icon={<RefreshCcw />}
        title={discoverStrings.notSyncedTitle}
        description={discoverStrings.notSyncedDescription(currentSource.name)}
        action={<Button variant="primary" onClick={onOpenSources}>{discoverStrings.openSources}</Button>}
      />
    );
  } else if (curated && results.length === 0) {
    content = (
      <EmptyState
        icon={<SearchX />}
        title={discoverStrings.smartNoPicksTitle}
        description={discoverStrings.smartNoPicksDescription(smart?.candidatesRead ?? 0)}
        action={<Button variant="primary" onClick={() => setSmartBroad(true)}>{discoverStrings.smartShowBroad}</Button>}
      />
    );
  } else if (results.length === 0) {
    content = (
      <EmptyState
        icon={<SearchX />}
        title={discoverStrings.noResultsTitle}
        description={discoverStrings.noResultsDescription}
        action={clearable ? <Button variant="primary" onClick={clearFilters}>{discoverStrings.clearFilters}</Button> : undefined}
      />
    );
  } else {
    content = (
      <DiscoverGrid
        novels={visibleResults}
        stacks={visibleStacks}
        total={cardCount}
        visibleCount={Math.min(visibleCount, cardCount)}
        selectedId={selectedNovel?.id}
        detailId={detailNovel?.id}
        scrollRoot={scrollRef}
        onShowMore={showMore}
        onSelect={onSelectNovel}
        onPreview={onPreviewNovel}
        reasons={smart?.reasons}
      />
    );
  }

  return (
    <div className={cx("discover", detailNovel && "discover--with-detail")}>
      <div className="discover__main" onClick={onBackgroundClick}>
        {onClearSmart ? (
          <SmartFilterStatus
            result={smart}
            busy={smartBusy}
            stage={smartStage}
            broad={smartBroad}
            broadCount={allResults.length}
            onToggleBroad={() => setSmartBroad((value) => !value)}
            onClear={onClearSmart}
          />
        ) : null}
        {showFilterBar ? (
          <DiscoverFilterBar
            filters={filters}
            tagCatalog={tagCatalog}
            scrolled={scrolled}
            onChange={changeFilters}
            onClear={clearFilters}
          />
        ) : null}
        <div
          className="discover__scroll"
          data-testid="content-area"
          ref={scrollRef}
          onScroll={(event) => {
            setScrolled(event.currentTarget.scrollTop > 0);
            if (detailNovel) noteAnchor(detailNovel.id);
          }}
          onClickCapture={(event) => {
            const card = (event.target as HTMLElement).closest<HTMLElement>("[data-novel-ids]");
            const id = card?.dataset.novelIds?.split(" ")[0];
            if (card && id) noteAnchor(id, card);
          }}
        >
          <section className="discover__results" aria-labelledby="discover-results-heading">
            <h2 className="sr-only" id="discover-results-heading">{discoverStrings.results}</h2>
            {content}
          </section>
        </div>
      </div>
      {detailNovel ? (
        <DiscoverDetailPanel
          novel={detailNovel}
          isSelected={selectedNovel?.id === detailNovel.id}
          preview={detailFromPreview}
          selection={selection}
          adding={adding}
          inLibrary={selectedInLibrary}
          queued={selectedQueued}
          onClose={closeDetail}
          onSelect={onSelectNovel}
          onSelectionChange={onSelectionChange}
          onAdd={onAddSelected}
          editions={related?.editions}
          similar={related?.similar}
          onOpenNovel={onPreviewNovel}
          shelf={shelf}
        />
      ) : null}
    </div>
  );
}
