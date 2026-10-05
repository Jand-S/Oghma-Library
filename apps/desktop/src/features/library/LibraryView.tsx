import { BookOpenText, FolderCog, Group, SearchX, Ungroup } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useNavigation, type AppView } from "../../app/NavigationContext";
import type { DownloadJob, LibraryItem, Novel } from "../../core/types";
import { editionsOf, workKey, type CatalogIndex } from "../../services/catalogIndex";
import { libraryStrings } from "../../strings/library";
import { Button, EmptyState, Skeleton, cx, type MenuItem } from "../../ui";
import { LibraryCollection } from "./LibraryCollection";
import { LibraryDetails } from "./LibraryDetails";
import { LibraryFilterBar } from "./LibraryHeader";
import { bookJobState, stackEditions } from "./libraryModel";
import { useBookActions } from "./useBookActions";
import { canRedownload, type LibraryController } from "./useLibraryController";
import "./library.css";

type LibraryViewProps = {
  library: LibraryController;
  activeJob: DownloadJob | null;
  queuedJobs: DownloadJob[];
  loading: boolean;
  navigate: (view: AppView) => void;
  /** Catalog of every source: "Procurar em outra fonte" for books whose source left. */
  catalogIndex?: CatalogIndex | null;
};

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
export function LibraryView({ library, activeJob, queuedJobs, loading, navigate, catalogIndex }: LibraryViewProps) {
  const navigation = useNavigation();
  const detailId = typeof navigation.params.book === "string" ? navigation.params.book : null;
  const detailItem = detailId ? library.allLibrary.find((item) => item.id === detailId) ?? null : null;

  const scrollRef = useRef<HTMLDivElement>(null);
  const savedScroll = useRef(0);

  const browse = library.browse;
  const filtered = browse.filtered;

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

  const findEditions = useCallback((item: LibraryItem): Novel[] => {
    if (!catalogIndex) return [];
    const known = item.novelId ? catalogIndex.byId.get(item.novelId) : undefined;
    // A book whose source left the catalog: match the work by its title (and the server's story matches).
    const probe = known ?? ({ id: item.novelId ?? item.id, title: item.title, sourceId: item.sourceId ?? "" } as Novel);
    return editionsOf(catalogIndex, probe);
  }, [catalogIndex]);

  // Grid stacks: a translation goes with the book it came from; the same novel from other
  // sources goes with it when the catalog titles match (accents, case and "(Novel)" ignored)
  // or the server linked the two (synopsis, translated title). Books the reader separated
  // stay alone.
  const separated = browse.separated;
  const stacks = useMemo(() => {
    if (!browse.stacks) return null;
    const keysOf = (item: LibraryItem): string[] => {
      if (separated.has(item.id)) return [];
      const base = item.language ? item.translatedFrom : item.novelId;
      const known = base && catalogIndex
        ? catalogIndex.byId.get(base) ?? catalogIndex.entries.find((entry) => entry.novel.aliases?.includes(base))?.novel
        : undefined;
      const title = workKey(known?.title ?? (item.language ? item.title.replace(/\s*\([^)]*\)\s*$/, "") : item.title));
      const linked = known ? [known.id, ...(catalogIndex?.discovery?.editions.get(known.id) ?? [])] : [];
      return [...(title ? [`t:${title}`] : []), ...linked.map((id) => `n:${id}`)];
    };
    return stackEditions(filtered, keysOf);
  }, [browse.stacks, catalogIndex, filtered, separated]);

  /** "Separar desta pilha" on an edition of a stack; "Voltar para a pilha" once separated. */
  const stackMenuItem = useCallback((item: LibraryItem): MenuItem | null => {
    if (separated.has(item.id)) {
      return { label: libraryStrings.backToStack, icon: <Group />, onSelect: () => browse.toggleSeparated(item.id), separatorBefore: true };
    }
    const inStack = stacks?.some((stack) => stack.items.length > 1 && stack.items.some((edition) => edition.id === item.id));
    return inStack
      ? { label: libraryStrings.separateFromStack, icon: <Ungroup />, onSelect: () => browse.toggleSeparated(item.id), separatorBefore: true }
      : null;
  }, [browse, separated, stacks]);

  const actions = useBookActions({ library, canRedownload, isBusy, onOpenDetails: openDetails, editionsOf: findEditions, stackMenuItem });

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

  // No folder yet but books on the shelf (e.g. a new computer signed in to the account): show them.
  const noOutput = !library.outputPath.trim() && !library.allLibrary.some((item) => item.availability === "shelf");
  /** Nothing to browse at all (no folder, or an empty library): the empty state centers in the page. */
  const pageEmpty = noOutput || (!loading && library.allLibrary.length === 0);
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
  } else if (loading && library.allLibrary.length === 0) {
    content = <LoadingGrid />;
  } else if (library.allLibrary.length === 0) {
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
        action={<Button variant="outline" onClick={browse.clearFilters}>{libraryStrings.clearFilters}</Button>}
      />
    );
  } else {
    content = (
      <LibraryCollection
        items={filtered}
        stacks={stacks}
        view={browse.view}
        jobState={jobState}
        actions={actions}
        onOpen={openDetails}
        onOpenFolder={library.openLibraryItemFolder}
      />
    );
  }

  return (
    <div className="library-page" data-testid="library-page" aria-busy={loading || undefined}>
      {pageEmpty ? null : (
        <LibraryFilterBar browse={browse} />
      )}
      <div className={cx("library-scroll", pageEmpty && "library-scroll--center")} ref={scrollRef} data-testid="library-results">
        {content}
      </div>
      {actions.dialogs}
    </div>
  );
}
