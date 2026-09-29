import { FolderOpen, Heart, MoreVertical } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import type { LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Badge, Cover, DropdownMenu, IconButton, Spinner, cx, type MenuPoint } from "../../ui";
import { formatDownloadedAt, formatSummary, formatsOf, jobLabel, type BookJobState, type LibraryViewMode } from "./libraryModel";
import type { BookActions } from "./useBookActions";

type CollectionProps = {
  items: LibraryItem[];
  view: LibraryViewMode;
  jobState: (item: LibraryItem) => BookJobState | null;
  actions: BookActions;
  onOpen: (item: LibraryItem) => void;
  onOpenFolder: (item: LibraryItem) => void;
};

type ContextState = { item: LibraryItem; position: MenuPoint } | null;

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

/** Grid of covers or dense list, with a shared right-click menu. */
export function LibraryCollection({ items, view, jobState, actions, onOpen, onOpenFolder }: CollectionProps) {
  const [context, setContext] = useState<ContextState>(null);

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
          {items.map((item) => {
            const state = jobState(item);
            return (
              <li key={item.id} className="library-grid__cell">
                <article
                  className={cx("library-card", state && "is-busy")}
                  data-testid="library-card"
                  onClick={openItem(item)}
                  onContextMenu={openContext(item)}
                >
                  <div className="library-card__media">
                    <Cover src={item.coverUrl} title={item.title} size="fill" sheen className="library-card__cover" />
                    <div className="library-card__overlay" aria-hidden="true" />
                    <span className="library-card__formats" title={formatsOf(item).join(", ")}>{formatSummary(item)}</span>
                    {state ? <JobBadge state={state} className="library-card__status" /> : null}
                    {item.favorite ? (
                      <span className="library-card__favorite" title={libraryStrings.favorite}>
                        <Heart aria-hidden="true" />
                        <span className="sr-only">{libraryStrings.favorite}</span>
                      </span>
                    ) : null}
                    {moreMenu(item, "library-card__menu", "glass")}
                  </div>
                  <div className="library-card__body">
                    <button
                      type="button"
                      className="library-card__title"
                      data-testid="card-title"
                      title={item.title}
                      aria-label={libraryStrings.openDetailsOf(item.title)}
                    >
                      {item.title}
                    </button>
                    <span className="library-card__meta">
                      {[item.author, item.chapters ? libraryStrings.chapters(item.chapters) : libraryStrings.size(item.sizeMb)]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
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
                  className={cx("library-row", state && "is-busy")}
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
                  <div className="library-row__formats">
                    {formatsOf(item).map((format) => <Badge key={format}>{format}</Badge>)}
                  </div>
                  <span className="library-row__num">{libraryStrings.size(item.sizeMb)}</span>
                  <span className="library-row__date">{formatDownloadedAt(item)}</span>
                  <div className="library-row__actions" data-card-control>
                    <IconButton label={`${libraryStrings.openFolder}: ${item.title}`} icon={<FolderOpen />} size="sm" onClick={() => onOpenFolder(item)} />
                    {moreMenu(item, "library-row__menu", "ghost")}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
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
