import { useMemo } from "react";
import { buildFallbackTagCatalog, contentRatingForNovel } from "../../core/tagFilters";
import type { LibraryItem, Novel } from "../../core/types";
import { similarNovels, sortNovels, type CatalogIndex, type NovelSort } from "../../services/catalogIndex";
import { homeStrings } from "../../strings/home";
import { Avatar, Cover, SectionHeader, Skeleton } from "../../ui";
import type { ActivityItem, UserCard } from "../../services/socialClient";
import { socialStrings } from "../../strings/social";
import { shortWhen } from "../social/socialEnv";
import "../social/social.css";
import { HomeFeatured } from "./HomeFeatured";
import { HomeGenres, type GenreTile } from "./HomeGenres";
import { HomeBookCard, HomeShelf, HomeTile } from "./HomeShelf";
import "./home.css";

/** What "Ver tudo" opens in Buscar: an order and optionally a status. */
export type HomeSeeAll = { sort: NovelSort; status?: "complete" };

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
  /** Buscar with the shelf's order applied. */
  onSeeAll: (preset: HomeSeeAll) => void;
  /** Buscar filtered by a tag. */
  onBrowseTag: (key: string) => void;
  onOpenLibrary: () => void;
  /** Books friends recommended (newest first) and their recent activity; absent without friends. */
  friends?: HomeFriends;
};

export type HomeFriends = {
  recommended: Array<{ id: number; novelId: string; title: string; cover?: string; from: string }>;
  activity: ActivityItem[];
  /** The catalog novel for an id (opens its panel in Buscar). */
  resolve: (novelId: string) => Novel | undefined;
  onSeeRecommendations: () => void;
  onOpenFriends: () => void;
};

type FriendsBook = { novelId: string; title: string; cover?: string; readers: UserCard[] };

/**
 * What friends are reading now, from their activity: a book counts while its latest event per
 * friend is "started" (finishing or dropping it takes it off). Most recent first.
 */
export function readingNow(activity: ActivityItem[]): FriendsBook[] {
  const latest = new Map<string, ActivityItem>();
  for (const item of activity) {
    const key = `${item.user.publicId} ${item.novelId}`;
    const seen = latest.get(key);
    if (!seen || new Date(item.at).getTime() > new Date(seen.at).getTime()) latest.set(key, item);
  }
  const books = new Map<string, FriendsBook & { at: number }>();
  for (const item of latest.values()) {
    if (item.kind !== "started") continue;
    const at = new Date(item.at).getTime();
    const book = books.get(item.novelId) ?? { novelId: item.novelId, title: item.snapshot?.title ?? item.novelId, cover: item.snapshot?.coverUrl, readers: [], at };
    book.readers.push(item.user);
    book.at = Math.max(book.at, at);
    books.set(item.novelId, book);
  }
  return [...books.values()].sort((a, b) => b.at - a.at).slice(0, 14);
}

const SHELF = 14;
const FEATURED = 5;
const GENRES = 10;
/** Seeds that get their own "Porque você leu X" row. */
const BECAUSE_ROWS = 2;

type Shelf =
  | { id: string; title: string; hint?: string; kind: "book"; items: LibraryItem[] }
  | { id: string; title: string; hint?: string; kind: "novel"; items: Novel[]; seeAll?: HomeSeeAll };

const hasStory = (novel: Novel) => Boolean(novel.coverUrl && novel.description && novel.description.trim().length > 80);

/**
 * Início, in the Apple Books/TV mould: a featured hero, the reader's books, rows of
 * suggestions with "Ver tudo", and genres to explore. Empty rows hide, so a new user sees
 * the catalog rows; a reader sees their books and new chapters first.
 */
export function HomeView({ catalogIndex, library, sourceIds, loading, onOpenNovel, onOpenBook, onSeeAll, onBrowseTag, onOpenLibrary, friends }: HomeViewProps) {
  const model = useMemo(() => {
    const shelves: Shelf[] = [];
    const reading = library.filter((item) => item.readingStatus === "reading");
    if (reading.length) shelves.push({ id: "reading", title: homeStrings.reading, kind: "book", items: reading.slice(0, SHELF) });
    const updated = library.filter((item) => item.newChapters).sort((a, b) => (b.newChapters ?? 0) - (a.newChapters ?? 0));
    if (updated.length) shelves.push({ id: "new-chapters", title: homeStrings.newChapters, hint: homeStrings.newChaptersHint, kind: "book", items: updated.slice(0, SHELF) });
    if (!catalogIndex) return { shelves, featured: [] as Novel[], featuredFromLibrary: false, genres: [] as GenreTile[] };

    const enabled = new Set(sourceIds);
    const catalog = catalogIndex.entries.map((entry) => entry.novel).filter((novel) => enabled.has(novel.sourceId));
    const owned = new Set(library.map((item) => item.novelId).filter((id): id is string => Boolean(id)));

    // Seeds: what the reader rated high, favorites and what is being read pull the suggestions;
    // low ratings and dropped books push their look-alikes down.
    const { seeds, weights, avoid, seedItems } = homeSeeds(library, catalogIndex);

    const forYou = similarNovels(catalogIndex, seeds, { limit: SHELF, exclude: owned, sourceIds, weights, avoid });
    const because: Shelf[] = [];
    seeds.slice(0, BECAUSE_ROWS).forEach((seed, i) => {
      const items = similarNovels(catalogIndex, [seed], { limit: SHELF, exclude: owned, sourceIds, avoid });
      if (items.length < 4) return;
      const title = seedItems[i].rating === 5 ? homeStrings.becauseYouLoved(seed.title) : homeStrings.becauseYouRead(seed.title);
      because.push({ id: `because-${seed.id}`, title, kind: "novel", items });
    });
    if (forYou.length) shelves.push({ id: "for-you", title: homeStrings.forYou, hint: homeStrings.forYouHint, kind: "novel", items: forYou });
    shelves.push(...because);

    const fresh = sortNovels(catalog.filter((novel) => novel.lastChapterAt), "updated").slice(0, SHELF);
    if (fresh.length) shelves.push({ id: "updated", title: homeStrings.updated, kind: "novel", items: fresh, seeAll: { sort: "updated" } });
    const arrivals = sortNovels(catalog.filter((novel) => novel.firstSeenAt), "new").slice(0, SHELF);
    if (arrivals.length) shelves.push({ id: "new", title: homeStrings.arrivals, kind: "novel", items: arrivals, seeAll: { sort: "new" } });
    const rated = sortNovels(catalog.filter((novel) => novel.rating && (novel.ratingVotes ?? 0) >= 5), "rating");
    if (rated.length) shelves.push({ id: "rated", title: homeStrings.bestRated, kind: "novel", items: rated.slice(0, SHELF), seeAll: { sort: "rating" } });
    const complete = sortNovels(catalog.filter((novel) => novel.status === "complete"), "chapters");
    if (!shelves.some((shelf) => shelf.kind === "novel") && complete.length) {
      // Catalogs published before the dated fields: show the longest finished works instead.
      shelves.push({ id: "complete", title: homeStrings.completeWorks, kind: "novel", items: complete.slice(0, SHELF), seeAll: { sort: "chapters", status: "complete" } });
    }

    // Hero: the best "Para você" picks with a cover and a real synopsis; else the best rated.
    const featuredFromLibrary = forYou.filter(hasStory).length >= 3;
    const pool = featuredFromLibrary ? forYou : [...rated, ...fresh, ...complete];
    const seen = new Set<string>();
    const featured = pool.filter((novel) => {
      if (!hasStory(novel) || owned.has(novel.id) || seen.has(novel.id) || contentRatingForNovel(novel) === "erotic") return false;
      seen.add(novel.id);
      return true;
    }).slice(0, FEATURED);

    // Genres: the most common story genres in the enabled sources (never the erotic ones).
    const byTag = new Map<string, Novel[]>();
    for (const entry of catalogIndex.entries) {
      if (!enabled.has(entry.novel.sourceId)) continue;
      for (const key of entry.tagKeys) {
        if (!key.startsWith("genre.") || EXCLUDED_GENRES.has(key)) continue;
        const list = byTag.get(key);
        if (list) list.push(entry.novel);
        else byTag.set(key, [entry.novel]);
      }
    }
    const labels = new Map(buildFallbackTagCatalog(catalog).map((tag) => [tag.key, tag.label]));
    const genres: GenreTile[] = [...byTag.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, GENRES)
      .map(([key, novels]) => ({
        key,
        label: labels.get(key) ?? key.replace(/^genre\./, ""),
        count: novels.length,
        covers: sortNovels(novels.filter((novel) => novel.coverUrl && contentRatingForNovel(novel) !== "erotic"), "rating").slice(0, 3)
      }));

    return { shelves, featured, featuredFromLibrary, genres };
  }, [catalogIndex, library, sourceIds]);

  if (loading && !catalogIndex) {
    return (
      <div className="o-page home-page" aria-busy="true">
        <Skeleton width="100%" height="calc(var(--space-8) * 5)" radius="var(--radius-xl)" />
        {[0, 1].map((row) => (
          <section className="home-shelf" key={row}>
            <Skeleton width="30%" height="var(--fs-xl)" />
            <div className="home-shelf__row">
              {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} width="var(--home-tile)" height="calc(var(--home-tile) * 1.5)" radius="var(--radius-md)" />)}
            </div>
          </section>
        ))}
      </div>
    );
  }

  const { shelves, featured, featuredFromLibrary, genres } = model;
  const friendsReading = friends ? readingNow(friends.activity) : [];
  const bookShelves = shelves.filter((shelf): shelf is Extract<Shelf, { kind: "book" }> => shelf.kind === "book");
  const novelShelves = shelves.filter((shelf): shelf is Extract<Shelf, { kind: "novel" }> => shelf.kind === "novel");
  // Personal rows and the first catalog row, then genres, then the remaining catalog rows.
  const firstCatalogRow = novelShelves.findIndex((shelf) => shelf.seeAll);
  const splitAt = firstCatalogRow < 0 ? novelShelves.length : firstCatalogRow + 1;
  const leading = novelShelves.slice(0, splitAt);
  const trailing = novelShelves.slice(splitAt);

  const renderNovelShelf = (shelf: Extract<Shelf, { kind: "novel" }>) => (
    <HomeShelf key={shelf.id} id={shelf.id} title={shelf.title} subtitle={shelf.hint} onSeeAll={shelf.seeAll ? () => onSeeAll(shelf.seeAll!) : undefined}>
      {shelf.items.map((novel) => (
        <HomeTile key={novel.id} title={novel.title} cover={novel.coverUrl} meta={novel.sourceName} onClick={() => onOpenNovel(novel)} />
      ))}
    </HomeShelf>
  );

  return (
    <div className="o-page home-page" data-testid="home-page">
      {featured.length ? (
        <HomeFeatured novels={featured} eyebrow={featuredFromLibrary ? homeStrings.forYou : homeStrings.featured} onOpen={onOpenNovel} />
      ) : null}
      {library.length === 0 ? (
        <p className="home-tip" data-testid="home-welcome">{homeStrings.welcomeTip}</p>
      ) : null}
      {bookShelves.map((shelf) => (
        <HomeShelf key={shelf.id} id={shelf.id} title={shelf.title} subtitle={shelf.hint} variant="wide" onSeeAll={onOpenLibrary}>
          {shelf.items.map((item) => (
            <HomeBookCard
              key={item.id}
              title={item.title}
              cover={item.coverUrl}
              meta={item.sourceName ?? item.author}
              accent={item.newChapters ? homeStrings.plusChapters(item.newChapters) : undefined}
              onClick={() => onOpenBook(item)}
            />
          ))}
        </HomeShelf>
      ))}
      {friendsReading.length && friends ? (
        <HomeShelf id="friends-reading" title={socialStrings.friendsReadingTitle} onSeeAll={friends.onOpenFriends}>
          {friendsReading.map((book) => {
            const novel = friends.resolve(book.novelId);
            return (
              <HomeTile
                key={book.novelId}
                title={novel?.title ?? book.title}
                cover={novel?.coverUrl ?? book.cover}
                meta={socialStrings.friendsReadingMeta(book.readers.map((reader) => reader.nickname))}
                badge={book.readers.slice(0, 2).map((reader) => (
                  <Avatar key={reader.publicId} avatarId={reader.avatarId} color={reader.avatarColor} nickname={reader.nickname} size="sm" />
                ))}
                onClick={() => (novel ? onOpenNovel(novel) : friends.onOpenFriends())}
              />
            );
          })}
        </HomeShelf>
      ) : null}
      {friends?.recommended.length ? (
        <HomeShelf id="from-friends" title={socialStrings.fromFriendsTitle} onSeeAll={friends.onSeeRecommendations}>
          {friends.recommended.map((rec) => {
            const novel = friends.resolve(rec.novelId);
            return (
              <HomeTile
                key={rec.id}
                title={novel?.title ?? rec.title}
                cover={novel?.coverUrl ?? rec.cover}
                meta={`@${rec.from}`}
                accent
                onClick={() => (novel ? onOpenNovel(novel) : friends.onSeeRecommendations())}
              />
            );
          })}
        </HomeShelf>
      ) : null}
      {friends?.activity.length ? <FriendsActivity friends={friends} onOpenNovel={onOpenNovel} /> : null}
      {leading.map(renderNovelShelf)}
      <HomeGenres genres={genres} onBrowse={onBrowseTag} />
      {trailing.map(renderNovelShelf)}
    </div>
  );
}

/** "Atividade dos amigos": the last few things friends started, finished or rated. */
function FriendsActivity({ friends, onOpenNovel }: { friends: HomeFriends; onOpenNovel: (novel: Novel) => void }) {
  return (
    <section className="home-shelf" aria-labelledby="home-friends-activity">
      <SectionHeader id="home-friends-activity" title={socialStrings.activityTitle} />
      <ul className="social-activity">
        {friends.activity.slice(0, 8).map((item) => {
          const novel = friends.resolve(item.novelId);
          const title = novel?.title ?? item.snapshot?.title ?? item.novelId;
          return (
            <li key={item.id}>
              <button type="button" className="social-activity__item" disabled={!novel} onClick={() => (novel ? onOpenNovel(novel) : undefined)}>
                <Avatar avatarId={item.user.avatarId} color={item.user.avatarColor} nickname={item.user.nickname} size="sm" />
                <Cover src={novel?.coverUrl ?? item.snapshot?.coverUrl} title={title} size="sm" />
                <span className="social-activity__text">
                  <strong>@{item.user.nickname}</strong> {socialStrings.activity(item.kind, item.rating)} <strong>{title}</strong>
                </span>
                <time dateTime={item.at}>{shortWhen(item.at)}</time>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const EXCLUDED_GENRES = new Set(["genre.erotic", "genre.explicit_erotic", "genre.adult", "genre.ecchi", "genre.smut", "genre.hentai"]);

/** ≤ this many stars, or dropped, counts as "not for me". */
const DISLIKE_MAX = 2;
const MAX_SEEDS = 8;
const MAX_AVOID = 6;

/**
 * How much a library book should pull the recommendations: stars weigh most (5★ = 3,
 * 4★ = 2, 3★ = 0.5), then favorite and reading; a book with no signal still counts a little.
 * Negative = the reader did not like it (≤ 2★ or dropped without a better rating).
 */
export function seedWeight(item: LibraryItem): number {
  const rating = item.rating ?? 0;
  if ((rating > 0 && rating <= DISLIKE_MAX) || (item.readingStatus === "dropped" && rating < 3)) return -1;
  const stars = rating === 5 ? 3 : rating === 4 ? 2 : rating === 3 ? 0.5 : 0;
  const status = item.readingStatus === "reading" ? 1.5 : item.readingStatus === "completed" && !rating ? 1 : 0;
  const weight = stars + (item.favorite ? 2 : 0) + status;
  return weight > 0 ? weight : 0.25;
}

/** Library books as recommendation seeds (best first, with weights) and the books to steer away from. */
export function homeSeeds(library: LibraryItem[], index: CatalogIndex) {
  const resolved = library
    .map((item) => ({ item, novel: item.novelId ? index.byId.get(item.novelId) : undefined, weight: seedWeight(item) }))
    .filter((entry): entry is { item: LibraryItem; novel: Novel; weight: number } => Boolean(entry.novel));
  const liked = resolved.filter((entry) => entry.weight > 0).sort((a, b) => b.weight - a.weight).slice(0, MAX_SEEDS);
  return {
    seeds: liked.map((entry) => entry.novel),
    weights: liked.map((entry) => entry.weight),
    seedItems: liked.map((entry) => entry.item),
    avoid: resolved.filter((entry) => entry.weight < 0).slice(0, MAX_AVOID).map((entry) => entry.novel)
  };
}
