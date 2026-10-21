// Small pieces shared by the library cards, rows and pages (badges, the favorite heart).
import { AlertTriangle, CloudDownload, Heart, Languages } from "lucide-react";
import type { LibraryItem } from "../../core/types";
import { accountFilesStrings } from "../../strings/accountFiles";
import { libraryStrings } from "../../strings/library";
import { Badge, IconButton, Spinner, cx } from "../../ui";
import { AccountFileBadge } from "./AccountFileBadge";
import { isTranslated, jobLabel, type BookJobState } from "./libraryModel";
import { isImported } from "./seriesModel";
import type { BookActions } from "./useBookActions";

export function JobBadge({ state, className }: { state: BookJobState; className?: string }) {
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

/** A book without files here: "Na estante" (catalog) or "Na conta" (imported, kept in the account). */
export function shelfLabel(item: LibraryItem) {
  return isImported(item) ? accountFilesStrings.inAccount : libraryStrings.onShelfBadge;
}

function shelfHint(item: LibraryItem) {
  if (item.unavailable) return libraryStrings.unavailableHint;
  return isImported(item) ? accountFilesStrings.shelfHint : libraryStrings.onShelfHint;
}

/** Cloud badge on books kept in the library without files; a warning when the source left. */
export function ShelfBadge({ item }: { item: LibraryItem }) {
  return (
    <span className="library-tile__formats library-tile__shelf" title={shelfHint(item)} data-testid="library-shelf-badge">
      {item.unavailable ? <AlertTriangle aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
      {item.unavailable ? libraryStrings.unavailableBadge : shelfLabel(item)}
    </span>
  );
}

/** The same, as a list-row badge. */
export function ShelfRowBadge({ item }: { item: LibraryItem }) {
  return (
    <Badge tone={item.unavailable ? "warning" : "neutral"} title={shelfHint(item)}>
      {item.unavailable ? <AlertTriangle aria-hidden="true" /> : <CloudDownload aria-hidden="true" />}
      {item.unavailable ? libraryStrings.unavailableBadge : shelfLabel(item)}
    </Badge>
  );
}

/** Account state of imported books (one book, or every volume of a series card). */
export function AccountBadge({ items, actions }: { items: LibraryItem[]; actions: BookActions }) {
  return <AccountFileBadge items={items} stateOf={actions.accountState} onRetry={actions.retryUpload} />;
}

/** One-click favorite: a heart that shows on hover and stays (filled) on favorite books. */
export function FavoriteToggle({ item, actions, className, variant }: { item: LibraryItem; actions: BookActions; className: string; variant: "glass" | "ghost" }) {
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
export function editionLabel(item: LibraryItem) {
  if (item.language) return libraryStrings.translationEdition(item.language.toUpperCase());
  return item.sourceName ?? libraryStrings.localSource;
}
