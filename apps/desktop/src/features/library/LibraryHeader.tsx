import { CloudDownload, EyeOff, Heart, Languages, LayoutGrid, List, RefreshCw, Search, X } from "lucide-react";
import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { libraryStrings } from "../../strings/library";
import { Badge, Chip, IconButton, SegmentedControl, SelectField, TextField } from "../../ui";
import { statusFilters, type LibrarySort, type LibraryStatusFilter, type LibraryViewMode } from "./libraryModel";
import { ReadingStatusIcon } from "./ReadingStatus";
import type { LibraryBrowse } from "./useLibraryBrowse";

const sortOptions = [
  { value: "recent", label: libraryStrings.sortRecent },
  { value: "title", label: libraryStrings.sortTitle },
  { value: "rating", label: libraryStrings.sortRating },
  { value: "size", label: libraryStrings.sortSize }
] as const;

/** True when the page shows the browsable collection (not details, not an empty/setup state). */
export function libraryBrowsable({ library, params }: AppControllers) {
  return typeof params.book !== "string" && Boolean(library.outputPath.trim()) && library.library.length > 0;
}

/** Library's PageHeader content: count, search, grid/list toggle and refresh. */
export function libraryHeader(app: AppControllers): ViewHeader {
  if (!libraryBrowsable(app)) return {};
  const { library } = app;
  const browse = library.browse;
  const total = library.library.length;
  const shown = browse.filtered.length;
  const filtered = shown !== total;
  return {
    badge: (
      <Badge tone={filtered ? "accent" : "neutral"} data-testid="library-count">
        {filtered ? libraryStrings.countFiltered(shown, total) : libraryStrings.count(total)}
      </Badge>
    ),
    search: (
      <TextField
        label={libraryStrings.searchLabel}
        hideLabel
        type="search"
        placeholder={libraryStrings.searchPlaceholder}
        value={browse.query}
        onChange={(event) => browse.setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && browse.query) {
            event.preventDefault();
            browse.setQuery("");
          }
        }}
        leading={<Search aria-hidden="true" />}
        trailing={browse.query ? (
          <IconButton label={libraryStrings.clearSearch} icon={<X />} size="sm" variant="ghost" onClick={() => browse.setQuery("")} />
        ) : undefined}
        data-testid="library-search"
        fieldClassName="o-field--sm"
      />
    ),
    actions: (
      <>
        <SegmentedControl<LibraryViewMode>
          aria-label={libraryStrings.viewLabel}
          size="sm"
          value={browse.view}
          onChange={browse.setView}
          options={[
            { value: "grid", label: <span className="sr-only">{libraryStrings.viewGrid}</span>, icon: <LayoutGrid /> },
            { value: "list", label: <span className="sr-only">{libraryStrings.viewList}</span>, icon: <List /> }
          ]}
        />
        <IconButton label={libraryStrings.refresh} icon={<RefreshCw />} size="sm" variant="ghost" onClick={library.refresh} />
      </>
    )
  };
}

function statusLabel(status: LibraryStatusFilter) {
  if (status === "all") return libraryStrings.allBooks;
  if (status === "shelf") return libraryStrings.shelfFilter;
  return libraryStrings.readingStatusPlural[status];
}

function StatusChipIcon({ status }: { status: LibraryStatusFilter }) {
  if (status === "all") return null;
  if (status === "shelf") return <CloudDownload />;
  return <ReadingStatusIcon status={status} />;
}

/** Sub-bar under the header: reading-status chips, format and favorites chips, plus the sort order. */
export function LibraryFilterBar({ browse }: { browse: LibraryBrowse }) {
  // Statuses with no book stay out of the way (the selected one always shows).
  const shown = statusFilters.filter((status) => status === "all" || status === browse.status || browse.statusCounts[status] > 0);
  return (
    <div className="library-bar" data-testid="library-toolbar">
      <div className="library-bar__filters">
        {shown.length > 1 ? (
          <div className="library-bar__group" role="group" aria-label={libraryStrings.statusFilterLabel} data-testid="library-status-filters">
            {shown.map((status) => (
              <Chip
                key={status}
                selected={browse.status === status}
                onToggle={() => browse.setStatus(status)}
                icon={<StatusChipIcon status={status} />}
              >
                {status === "all" ? statusLabel(status) : `${statusLabel(status)} ${browse.statusCounts[status].toLocaleString("pt-BR")}`}
              </Chip>
            ))}
          </div>
        ) : null}
        <div className="library-bar__group" role="group" aria-label={libraryStrings.formatFilterLabel}>
        {browse.formats.map((format) => (
          <Chip key={format} selected={browse.selectedFormats.has(format)} onToggle={() => browse.toggleFormat(format)}>
            {format}
          </Chip>
        ))}
        <Chip selected={browse.favoritesOnly} onToggle={browse.toggleFavorites} icon={<Heart />}>
          {libraryStrings.favoritesFilter}
        </Chip>
        {browse.hasTranslated || browse.translatedOnly ? (
          <Chip selected={browse.translatedOnly} onToggle={browse.toggleTranslated} icon={<Languages />}>
            {libraryStrings.translatedFilter}
          </Chip>
        ) : null}
        {browse.hiddenCount > 0 || browse.hiddenOnly ? (
          <Chip selected={browse.hiddenOnly} onToggle={browse.toggleHidden} icon={<EyeOff />}>
            {libraryStrings.hiddenFilter(browse.hiddenCount)}
          </Chip>
        ) : null}
        </div>
      </div>
      <SelectField
        label={libraryStrings.sortLabel}
        hideLabel
        options={sortOptions}
        value={browse.sort}
        onChange={(event) => browse.setSort(event.target.value as LibrarySort)}
        fieldClassName="o-field--sm library-bar__sort"
      />
    </div>
  );
}
