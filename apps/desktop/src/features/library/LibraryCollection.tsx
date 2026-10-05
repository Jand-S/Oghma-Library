import { AlertTriangle, CloudDownload, FolderOpen, Heart, Languages, Layers, MoreVertical } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Badge, Cover, DropdownMenu, IconButton, Spinner, StackSpread, StarRating, cx, type MenuPoint } from "../../ui";
import { formatDownloadedAt, formatSummary, formatsOf, isShelf, isTranslated, jobLabel, type BookJobState, type LibraryStack, type LibraryViewMode } from "./libraryModel";
import { ReadingStatusLabel } from "./ReadingStatus";
import type { BookActions } from "./useBookActions";

type CollectionProps = {
  items: LibraryItem[];
  /** Grid only: editions of the same work as one card (see `stackEditions`). */
  stacks?: LibraryStack[] | null;
  view: LibraryViewMode;
  jobState: (item: LibraryItem) => BookJobState | null;
  actions: BookActions;
  onOpen: (item: LibraryItem) => void;
  onOpenFolder: (item: LibraryItem) => void;
};

type ContextState = { item: LibraryItem; position: MenuPoint } | null;
type SpreadState = { stack: LibraryStack; anchor: HTMLElement } | null;

/** Clicks that bubble through React portals (menus, dialogs) must not open the book. */
function fromInside(event: ReactMouseEvent<HTMLElement>) {
  return event.currentTarget.contains(event.target as Node);
}

/** Pointer position, or the element's corner for the keyboard context-menu key. */
function menuPoint(event: ReactMouseEvent<HTMLElement>): MenuPoint {
  if (event.clientX || event.clientY) return { x: event.clientX, y: event.clientY };
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function JobBadge({ state, className }: { state: BookJobState; className?: string }) {
  return (
    <Badge tone={state.phase === "active" ? "accent" : "neutral"} className={className} data-testid="library-job-badge">
      {state.phase === "active" ? <Spinner size="sm" /> : null}
      {jobLabel(state)}
    </Badge>
  );
}

/** "PT-BR" (finished translation) or "Prévia 42%" (partial book). */
export function TranslationBadge({ item, className }: { item: LibraryItem; className?: string }) {
  if (!isTranslated(item)) return null;
  const preview = item.translationProgress != null;
  return (
    <Badge
      tone={preview ? "warning" : "accent"}
      className={cx("library-lang", className)}
      title={preview ? libraryStrings.previewBadgeTitle(item.translationProgress!) : libraryStrings.translatedBadgeTitle}
      data-testid="library-translation-badge"
    >
      <Languages aria-hidden="true" />
      <span className="library-lang__text">{preview ? libraryStrings.previewBadge(item.translationProgress!) : libraryStrings.translatedBadge}</span>
    </Badge>
  );
}

/** Cloud badge on books kept in the library without files; a warning when the source left. */
function ShelfBadge({ item }: { item: LibraryItem }) {
  return (
    <span
      className="library-tile__formats library-tile__shelf"
      title={item.unavailable ? libraryStrings.unavailableHint : libraryStrings.onShelfHint}
      data-testid="library-shelf-badge"
    >
      {item.unavailable ? <AlertTriangle aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
      {item.unavailable ? libraryStrings.unavailableBadge : libraryStrings.onShelfBadge}
    </span>
  );
}

/** One-click favorite: a heart that shows on hover and stays (filled) on favorite books. */
function FavoriteToggle({ item, actions, className, variant }: { item: LibraryItem; actions: BookActions; className: string; variant: "glass" | "ghost" }) {
  return (
    <span className={cx(className, item.favorite && "is-on")} data-card-control>
      <IconButton
        label={`${item.favorite ? libraryStrings.removeFavorite : libraryStrings.addFavorite}: ${item.title}`}
        icon={<Heart />}
        size="sm"
        variant={variant}
        aria-pressed={Boolean(item.favorite)}
        data-testid="library-favorite-toggle"
        onClick={() => actions.toggleFavorite(item)}
      />
    </span>
  );
}

/** How an edition is named in a stack: its source, or "Tradução PT-BR". */
function editionLabel(item: LibraryItem) {
  if (item.language) return libraryStrings.translationEdition(item.language.toUpperCase());
  return item.sourceName ?? libraryStrings.localSource;
}

/** Grid of covers or dense list, with a shared right-click menu. */
export function LibraryCollection({ items, stacks, view, jobState, actions, onOpen, onOpenFolder }: CollectionProps) {
  const [context, setContext] = useState<ContextState>(null);
  const [spread, setSpread] = useState<SpreadState>(null);
  const cards: LibraryStack[] = stacks ?? items.map((item) => ({ key: item.id, main: item, items: [item] }));

  const openContext = (item: LibraryItem) => (event: ReactMouseEvent<HTMLElement>) => {
    event.preventDefault();
    if (!fromInside(event)) return;
    setContext({ item, position: menuPoint(event) });
  };
  const openItem = (item: LibraryItem) => (event: ReactMouseEvent<HTMLElement>) => {
    if (!fromInside(event)) return;
    if ((event.target as HTMLElement).closest("[data-card-control]")) return;
    onOpen(item);
  };
  /** A stack opens its editions over the grid; a single book opens its details. */
  const openCard = (stack: LibraryStack) => (event: ReactMouseEvent<HTMLElement>) => {
    if (stack.items.length < 2) return openItem(stack.main)(event);
    if (!fromInside(event)) return;
    if ((event.target as HTMLElement).closest("[data-card-control]")) return;
    const anchor = event.currentTarget.querySelector<HTMLElement>(".library-tile__media");
    if (anchor) setSpread({ stack, anchor });
  };

  const moreMenu = (item: LibraryItem, className: string, variant: "glass" | "ghost") => (
    <span className={className} data-card-control>
      <DropdownMenu
        label={libraryStrings.cardActions(item.title)}
        align="end"
        items={actions.menuItems(item)}
        trigger={<IconButton label={libraryStrings.cardActions(item.title)} icon={<MoreVertical />} size="sm" variant={variant} />}
      />
    </span>
  );

  return (
    <>
      {view === "grid" ? (
        <ul className="library-grid" data-testid="library-grid">
          {cards.map((stack) => {
            const item = stack.main;
            const state = jobState(item);
            const editions = stack.items.length;
            // A stack is named after the work (the original's title, not "… (PT-BR)").
            const workTitle = editions > 1 ? stack.items.find((edition) => !edition.language)?.title ?? item.title : item.title;
            return (
              <li key={stack.key} className="library-grid__cell">
                <article
                  className={cx(
                    "library-tile",
                    state && "is-busy",
                    isShelf(item) && "is-shelf",
                    item.unavailable && "is-unavailable",
                    editions > 1 && "is-stack",
                    editions > 2 && "is-stack-deep",
                    spread?.stack.key === stack.key && "is-spread"
                  )}
                  data-testid="library-card"
                  data-editions={editions > 1 ? editions : undefined}
                  onClick={openCard(stack)}
                  onContextMenu={openContext(item)}
                >
                  <div className="library-tile__media">
                    <Cover src={item.coverUrl} title={item.title} size="fill" sheen className="library-tile__cover" />
                    <div className="library-tile__overlay" aria-hidden="true" />
                    {isShelf(item)
                      ? <ShelfBadge item={item} />
                      : <span className="library-tile__formats" title={formatsOf(item).join(", ")}>{formatSummary(item)}</span>}
                    {state || isTranslated(item) || item.newChapters ? (
                      <div className="library-tile__flags">
                        {state ? <JobBadge state={state} /> : null}
                        <TranslationBadge item={item} />
                        {!state && item.newChapters ? (
                          <Badge tone="accent" data-testid="library-new-chapters" title={libraryStrings.newChaptersHint(item.newChapters)}>
                            {libraryStrings.newChaptersShort(item.newChapters)}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}
                    <FavoriteToggle item={item} actions={actions} className="library-tile__favorite" variant="glass" />
                    {editions > 1 ? (
                      <span className="o-stack-count" data-testid="library-stack-count">
                        <Layers aria-hidden="true" />
                        {libraryStrings.editionsCount(editions)}
                      </span>
                    ) : null}
                    {moreMenu(item, "library-tile__menu", "glass")}
                  </div>
                  <div className="library-tile__body">
                    <button
                      type="button"
                      className="library-tile__title"
                      data-testid="card-title"
                      title={workTitle}
                      aria-label={editions > 1 ? libraryStrings.editionsOf(workTitle, editions) : libraryStrings.openDetailsOf(item.title)}
                      aria-haspopup={editions > 1 ? "dialog" : undefined}
                    >
                      {workTitle}
                    </button>
                    <span className="library-tile__meta">
                      {[item.author, item.chapters ? libraryStrings.chapters(item.chapters) : isShelf(item) ? "" : libraryStrings.size(item.sizeMb)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <div className="library-tile__footer">
                      <ReadingStatusLabel status={item.readingStatus} />
                      <span className={cx("library-tile__rating", Boolean(item.rating) && "is-rated")} data-card-control>
                        <StarRating
                          size="xs"
                          label={`${libraryStrings.ratingLabel}: ${item.title}`}
                          value={item.rating}
                          onChange={(value) => actions.rate(item, value)}
                        />
                      </span>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="library-list" data-testid="library-list">
          <div className="library-list__head" aria-hidden="true">
            <span />
            <span>{libraryStrings.listTitle}</span>
            <span>{libraryStrings.listStatus}</span>
            <span>{libraryStrings.listRating}</span>
            <span>{libraryStrings.listFormats}</span>
            <span className="library-list__num">{libraryStrings.listSize}</span>
            <span>{libraryStrings.listDate}</span>
            <span className="library-list__actions-head">{libraryStrings.listActions}</span>
          </div>
          <ul className="library-list__rows">
            {items.map((item) => {
              const state = jobState(item);
              return (
                <li
                  key={item.id}
                  className={cx("library-row", state && "is-busy", isShelf(item) && "is-shelf")}
                  data-testid="library-row"
                  onClick={openItem(item)}
                  onContextMenu={openContext(item)}
                >
                  <Cover src={item.coverUrl} title={item.title} size="sm" />
                  <div className="library-row__title">
                    <button type="button" className="library-row__name" data-testid="card-title" aria-label={libraryStrings.openDetailsOf(item.title)}>
                      {item.title}
                    </button>
                    <span className="library-row__sub">
                      {state ? <JobBadge state={state} /> : null}
                      {item.author || item.sourceName || libraryStrings.localSource}
                    </span>
                  </div>
                  <div className="library-row__status">
                    <ReadingStatusLabel status={item.readingStatus} />
                  </div>
                  <div className={cx("library-row__rating", Boolean(item.rating) && "is-rated")} data-card-control>
                    <StarRating
                      size="xs"
                      label={`${libraryStrings.ratingLabel}: ${item.title}`}
                      value={item.rating}
                      onChange={(value) => actions.rate(item, value)}
                    />
                  </div>
                  <div className="library-row__formats">
                    <TranslationBadge item={item} />
                    {isShelf(item) ? (
                      <Badge tone={item.unavailable ? "warning" : "neutral"} title={item.unavailable ? libraryStrings.unavailableHint : libraryStrings.onShelfHint}>
                        {item.unavailable ? <AlertTriangle aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
                        {item.unavailable ? libraryStrings.unavailableBadge : libraryStrings.onShelfBadge}
                      </Badge>
                    ) : formatsOf(item).map((format) => <Badge key={format}>{format}</Badge>)}
                  </div>
                  <span className="library-row__num">{isShelf(item) ? "—" : libraryStrings.size(item.sizeMb)}</span>
                  <span className="library-row__date">{formatDownloadedAt(item)}</span>
                  <div className="library-row__actions" data-card-control>
                    <FavoriteToggle item={item} actions={actions} className="library-row__favorite" variant="ghost" />
                    {isShelf(item) ? (
                      <IconButton
                        label={`${libraryStrings.download}: ${item.title}`}
                        icon={<CloudDownload />}
                        size="sm"
                        onClick={() => actions.download(item)}
                        disabled={Boolean(actions.redownloadDisabledReason(item))}
                      />
                    ) : (
                      <IconButton label={`${libraryStrings.openFolder}: ${item.title}`} icon={<FolderOpen />} size="sm" onClick={() => onOpenFolder(item)} />
                    )}
                    {moreMenu(item, "library-row__menu", "ghost")}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {spread ? (
        <StackSpread
          anchor={spread.anchor}
          title={spread.stack.items.find((edition) => !edition.language)?.title ?? spread.stack.main.title}
          count={libraryStrings.editionsCount(spread.stack.items.length)}
          items={spread.stack.items}
          itemKey={(edition) => edition.id}
          card={(edition) => ({
            cover: edition.coverUrl,
            title: edition.title,
            label: editionLabel(edition),
            meta: (
              <>
                {isShelf(edition) ? <Badge>{libraryStrings.onShelfBadge}</Badge> : <Badge tone="accent">{formatSummary(edition)}</Badge>}
                <ReadingStatusLabel status={edition.readingStatus} />
              </>
            )
          })}
          onPick={onOpen}
          onClose={() => setSpread(null)}
          returnFocus={spread.anchor.closest<HTMLElement>("[data-testid=library-card]")?.querySelector<HTMLElement>("[data-testid=card-title]")}
          data-testid="edition-spread"
        />
      ) : null}
      <DropdownMenu
        label={context ? libraryStrings.cardActions(context.item.title) : undefined}
        items={context ? actions.menuItems(context.item) : []}
        open={Boolean(context)}
        position={context?.position ?? null}
        onClose={() => setContext(null)}
      />
    </>
  );
}
