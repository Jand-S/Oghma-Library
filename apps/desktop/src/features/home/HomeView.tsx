import { Compass } from "lucide-react";
import { useMemo } from "react";
import type { LibraryItem, Novel } from "../../core/types";
import { similarNovels, sortNovels, type CatalogIndex } from "../../services/catalogIndex";
import { homeStrings } from "../../strings/home";
import { Button, Cover, EmptyState, Skeleton } from "../../ui";
import "./home.css";

export type HomeViewProps = {
  /** Every loaded novel (all sources); null while the catalog loads. */
  catalogIndex: CatalogIndex | null;
  /** Visible library books. */
  library: LibraryItem[];
  /** Enabled sources: shelves only show what the user can download. */
  sourceIds: string[];
  loading: boolean;
  onOpenNovel: (novel: Novel) => void;
  onOpenBook: (item: LibraryItem) => void;
  onExplore: () => void;
};

const SHELF = 14;

type Shelf =
  | { id: string; title: string; hint?: string; kind: "book"; items: LibraryItem[] }
  | { id: string; title: string; hint?: string; kind: "novel"; items: Novel[] };

/**
 * Início: what to read next. Shelves hide when empty, so a new user sees the catalog
 * shelves and an invitation to explore; a reader sees their books and new chapters first.
 */
export function HomeView({ catalogIndex, library, sourceIds, loading, onOpenNovel, onOpenBook, onExplore }: HomeViewProps) {
  const shelves = useMemo<Shelf[]>(() => {
    const out: Shelf[] = [];
    const reading = library.filter((item) => item.readingStatus === "reading");
    if (reading.length) out.push({ id: "reading", title: homeStrings.reading, kind: "book", items: reading.slice(0, SHELF) });
    const updated = library.filter((item) => item.newChapters).sort((a, b) => (b.newChapters ?? 0) - (a.newChapters ?? 0));
    if (updated.length) out.push({ id: "new-chapters", title: homeStrings.newChapters, hint: homeStrings.newChaptersHint, kind: "book", items: updated.slice(0, SHELF) });
    if (!catalogIndex) return out;

    const enabled = new Set(sourceIds);
    const catalog = catalogIndex.entries.map((entry) => entry.novel).filter((novel) => enabled.has(novel.sourceId));
    const owned = new Set(library.map((item) => item.novelId).filter((id): id is string => Boolean(id)));

    // "Para você": favorites weigh most, then what is being read, then anything downloaded.
    const ranked = [...library].sort((a, b) => score(b) - score(a));
    const seeds = ranked
      .map((item) => (item.novelId ? catalogIndex.byId.get(item.novelId) : undefined))
      .filter((novel): novel is Novel => Boolean(novel))
      .slice(0, 8);
    const forYou = similarNovels(catalogIndex, seeds, { limit: SHELF, exclude: owned, sourceIds });
    if (forYou.length) out.push({ id: "for-you", title: homeStrings.forYou, hint: homeStrings.forYouHint, kind: "novel", items: forYou });

    const fresh = sortNovels(catalog.filter((novel) => novel.lastChapterAt), "updated").slice(0, SHELF);
    if (fresh.length) out.push({ id: "updated", title: homeStrings.updated, kind: "novel", items: fresh });
    const arrivals = sortNovels(catalog.filter((novel) => novel.firstSeenAt), "new").slice(0, SHELF);
    if (arrivals.length) out.push({ id: "new", title: homeStrings.arrivals, kind: "novel", items: arrivals });
    const best = sortNovels(catalog.filter((novel) => novel.rating && (novel.ratingVotes ?? 0) >= 5), "rating").slice(0, SHELF);
    if (best.length) out.push({ id: "rated", title: homeStrings.bestRated, kind: "novel", items: best });
    if (!out.some((shelf) => shelf.kind === "novel")) {
      // Catalogs published before the dated fields: show the longest finished works instead.
      const complete = sortNovels(catalog.filter((novel) => novel.status === "complete"), "chapters").slice(0, SHELF);
      if (complete.length) out.push({ id: "complete", title: homeStrings.complete, kind: "novel", items: complete });
    }
    return out;
  }, [catalogIndex, library, sourceIds]);

  if (loading && !catalogIndex) {
    return (
      <div className="o-page home-page" aria-busy="true">
        {[0, 1].map((row) => (
          <section className="home-shelf" key={row}>
            <Skeleton width="30%" height="var(--fs-lg)" />
            <div className="home-shelf__row">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} width="var(--home-tile)" height="calc(var(--home-tile) * 1.5)" radius="var(--radius-md)" />)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="o-page home-page" data-testid="home-page">
      {library.length === 0 ? (
        <section className="home-welcome" data-testid="home-welcome">
          <EmptyState
            icon={<Compass />}
            title={homeStrings.welcomeTitle}
            description={homeStrings.welcomeDescription}
            action={<Button variant="primary" icon={<Compass />} onClick={onExplore}>{homeStrings.explore}</Button>}
          />
        </section>
      ) : null}
      {shelves.map((shelf) => (
        <section className="home-shelf" key={shelf.id} aria-labelledby={`home-${shelf.id}`} data-testid={`home-shelf-${shelf.id}`}>
          <div className="home-shelf__head">
            <h2 className="home-shelf__title" id={`home-${shelf.id}`}>{shelf.title}</h2>
            {shelf.hint ? <p className="home-shelf__hint">{shelf.hint}</p> : null}
          </div>
          <ul className="home-shelf__row">
            {shelf.kind === "book"
              ? shelf.items.map((item) => (
                  <li key={item.id}>
                    <Tile title={item.title} cover={item.coverUrl} meta={item.newChapters ? homeStrings.plusChapters(item.newChapters) : item.sourceName}
                      accent={Boolean(item.newChapters)} onClick={() => onOpenBook(item)} />
                  </li>
                ))
              : shelf.items.map((novel) => (
                  <li key={novel.id}>
                    <Tile title={novel.title} cover={novel.coverUrl} meta={novel.sourceName} onClick={() => onOpenNovel(novel)} />
                  </li>
                ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function score(item: LibraryItem) {
  return (item.favorite ? 4 : 0) + (item.readingStatus === "reading" ? 2 : item.readingStatus === "completed" ? 1 : 0);
}

function Tile({ title, cover, meta, accent = false, onClick }: { title: string; cover?: string; meta?: string; accent?: boolean; onClick: () => void }) {
  return (
    <button type="button" className="home-tile" onClick={onClick} title={title}>
      <Cover src={cover} title={title} size="fill" sheen className="home-tile__cover" />
      <span className="home-tile__title">{title}</span>
      {meta ? <span className={accent ? "home-tile__meta home-tile__meta--accent" : "home-tile__meta"}>{meta}</span> : null}
    </button>
  );
}
