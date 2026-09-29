import { BookOpenText, FolderCog, SearchX } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigation, type AppView } from "../../app/NavigationContext";
import type { DownloadFormat, DownloadJob, LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Button, EmptyState, Skeleton } from "../../ui";
import { LibraryCollection } from "./LibraryCollection";
import { LibraryDetails } from "./LibraryDetails";
import { LibraryToolbar } from "./LibraryToolbar";
import {
  availableFormats,
  bookJobState,
  filterLibrary,
  type LibrarySort,
  type LibraryViewMode
} from "./libraryModel";
import { useBookActions } from "./useBookActions";
import { canRedownload, type LibraryController } from "./useLibraryController";
import "./library.css";

type LibraryViewProps = {
  library: LibraryController;
  activeJob: DownloadJob | null;
  queuedJobs: DownloadJob[];
  loading: boolean;
  navigate: (view: AppView) => void;
};

const VIEW_KEY = "oghma.library.view";
const SORT_KEY = "oghma.library.sort";

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = window.localStorage.getItem(key) as T | null;
    return value && allowed.includes(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function writePref(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the preference is just not remembered.
  }
}

function LoadingGrid() {
  return (
    <ul className="library-grid" aria-hidden="true">
      {Array.from({ length: 12 }, (_, index) => (
        <li key={index} className="library-grid__cell library-skeleton">
          <Skeleton className="library-skeleton__cover" height="auto" />
          <Skeleton width="80%" height="1em" />
          <Skeleton width="50%" height="0.8em" />
        </li>
      ))}
    </ul>
  );
}

/** Library page: browse (grid or list) and, with `?book=<id>`, the book details. */
export function LibraryView({ library, activeJob, queuedJobs, loading, navigate }: LibraryViewProps) {
  const navigation = useNavigation();
  const detailId = typeof navigation.params.book === "string" ? navigation.params.book : null;
  const detailItem = detailId ? library.library.find((item) => item.id === detailId) ?? null : null;

  const [query, setQuery] = useState("");
  const [selectedFormats, setSelectedFormats] = useState<Set<DownloadFormat>>(() => new Set());
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<LibrarySort>(() => readPref(SORT_KEY, ["recent", "title", "size"], "recent"));
  const [view, setView] = useState<LibraryViewMode>(() => readPref(VIEW_KEY, ["grid", "list"], "grid"));
  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  const formats = useMemo(() => availableFormats(library.library), [library.library]);
  const filtered = useMemo(
    () => filterLibrary(library.library, { query, formats: selectedFormats, favoritesOnly, sort }),
    [favoritesOnly, library.library, query, selectedFormats, sort]
  );

  const jobs = { activeJob, queuedJobs };
  const jobState = (item: LibraryItem) => bookJobState(item, jobs);
  const isBusy = (item: LibraryItem) => Boolean(bookJobState(item, jobs));

  const openDetails = useCallback((item: LibraryItem) => {
    savedScroll.current = scrollRef.current?.scrollTop ?? 0;
    navigation.navigate("library", { book: item.id });
  }, [navigation]);

  const closeDetails = useCallback(() => {
    if (navigation.canGoBack) navigation.back();
    else navigation.navigate("library", {}, { replace: true });
  }, [navigation]);

  const actions = useBookActions({ library, canRedownload, isBusy, onOpenDetails: openDetails });

  // The book left the library (removed or deleted): go back to the grid.
  useEffect(() => {
    if (detailId && !detailItem && !loading) closeDetails();
  }, [closeDetails, detailId, detailItem, loading]);

  // Coming back from the details keeps the grid where it was.
  useLayoutEffect(() => {
    if (!detailId && scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
  }, [detailId]);

  // Esc on the details page goes back to the grid (menus and dialogs handle their own Esc first).
  useEffect(() => {
    if (!detailId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector("[role=dialog], [role=menu]")) return;
      closeDetails();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeDetails, detailId]);

  const clearFilters = () => {
    setQuery("");
    setSelectedFormats(new Set());
    setFavoritesOnly(false);
  };

  const toggleFormat = (format: DownloadFormat) =>
    setSelectedFormats((current) => {
      const next = new Set(current);
      if (next.has(format)) next.delete(format);
      else next.add(format);
      return next;
    });

  if (detailItem) {
    return (
      <div className="library-page library-page--details" data-testid="library-page">
        <div className="library-scroll">
          <LibraryDetails item={detailItem} library={library} actions={actions} jobState={jobState(detailItem)} />
        </div>
        {actions.dialogs}
      </div>
    );
  }

  const noOutput = !library.outputPath.trim();
  let content;
  if (noOutput) {
    content = (
      <EmptyState
        icon={<FolderCog />}
        title={libraryStrings.noOutputTitle}
        description={libraryStrings.noOutputDescription}
        action={<Button variant="primary" icon={<FolderCog />} onClick={() => navigate("settings")}>{libraryStrings.noOutputAction}</Button>}
      />
    );
  } else if (loading && library.library.length === 0) {
    content = <LoadingGrid />;
  } else if (library.library.length === 0) {
    content = (
      <EmptyState
        icon={<BookOpenText />}
        title={libraryStrings.emptyTitle}
        description={libraryStrings.emptyDescription}
        action={<Button variant="primary" icon={<BookOpenText />} onClick={() => navigate("discover")}>{libraryStrings.emptyAction}</Button>}
      />
    );
  } else if (filtered.length === 0) {
    content = (
      <EmptyState
        icon={<SearchX />}
        title={libraryStrings.noMatchTitle}
        description={libraryStrings.noMatchDescription}
        action={<Button variant="outline" onClick={clearFilters}>{libraryStrings.clearFilters}</Button>}
      />
    );
  } else {
    content = (
      <LibraryCollection
        items={filtered}
        view={view}
        jobState={jobState}
        actions={actions}
        onOpen={openDetails}
        onOpenFolder={library.openLibraryItemFolder}
      />
    );
  }

  return (
    <div className="library-page" data-testid="library-page" aria-busy={loading || undefined}>
      {noOutput || (!loading && library.library.length === 0) ? null : (
        <LibraryToolbar
          total={library.library.length}
          shown={filtered.length}
          query={query}
          onQueryChange={setQuery}
          formats={formats}
          selectedFormats={selectedFormats}
          onToggleFormat={toggleFormat}
          favoritesOnly={favoritesOnly}
          onToggleFavorites={() => setFavoritesOnly((value) => !value)}
          sort={sort}
          onSortChange={(value) => {
            setSort(value);
            writePref(SORT_KEY, value);
          }}
          view={view}
          onViewChange={(value) => {
            setView(value);
            writePref(VIEW_KEY, value);
          }}
          onRefresh={library.refresh}
        />
      )}
      <div className="library-scroll" ref={scrollRef} data-testid="library-results">
        {content}
      </div>
      {actions.dialogs}
    </div>
  );
}
