import { CloudDownload, EyeOff, Heart, Languages, Layers, LayoutGrid, List, ListFilter, RefreshCw, Search, X } from "lucide-react";
import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { libraryStrings } from "../../strings/library";
import { Badge, Button, Chip, DropdownMenu, IconButton, SegmentedControl, SelectField, TextField, cx, type MenuItem } from "../../ui";
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
        {browse.view === "grid" ? (
          <IconButton
            label={browse.stacks ? libraryStrings.stacksOff : libraryStrings.stacksOn}
            icon={<Layers />}
            size="sm"
            variant="ghost"
            className={cx("library-stacks-toggle", browse.stacks && "is-on")}
            aria-pressed={browse.stacks}
            data-testid="library-stacks-toggle"
            onClick={browse.toggleStacks}
          />
        ) : null}
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

/**
 * Formats, favorites, translated and hidden books: used less than the status chips, so they
 * live in one "Filtros" menu (the bar stays on one line). The button shows how many are on.
 */
function FiltersMenu({ browse }: { browse: LibraryBrowse }) {
  const active = browse.selectedFormats.size + Number(browse.favoritesOnly) + Number(browse.translatedOnly) + Number(browse.hiddenOnly);
  const items: MenuItem[] = [
    ...browse.formats.map((format, index): MenuItem => ({
      label: format,
      heading: index === 0 ? libraryStrings.formatFilterLabel : undefined,
      checked: browse.selectedFormats.has(format),
      multiple: true,
      onSelect: () => browse.toggleFormat(format)
    })),
    {
      label: libraryStrings.favoritesFilter,
      icon: <Heart />,
      heading: libraryStrings.showFilterLabel,
      separatorBefore: browse.formats.length > 0,
      checked: browse.favoritesOnly,
      multiple: true,
      onSelect: browse.toggleFavorites
    },
    ...(browse.hasTranslated || browse.translatedOnly
      ? [{ label: libraryStrings.translatedFilter, icon: <Languages />, checked: browse.translatedOnly, multiple: true, onSelect: browse.toggleTranslated }]
      : []),
    ...(browse.hiddenCount > 0 || browse.hiddenOnly
      ? [{ label: libraryStrings.hiddenFilter(browse.hiddenCount), icon: <EyeOff />, checked: browse.hiddenOnly, multiple: true, onSelect: browse.toggleHidden }]
      : []),
    ...(active > 0 ? [{ label: libraryStrings.clearFilterMenu, icon: <X />, separatorBefore: true, onSelect: browse.clearMenuFilters }] : [])
  ];
  return (
    <DropdownMenu
      label={libraryStrings.filtersMenu}
      align="end"
      items={items}
      trigger={(
        <Button
          variant={active ? "outline" : "ghost"}
          size="sm"
          icon={<ListFilter />}
          className={cx("library-bar__filters-button", active > 0 && "is-active")}
          aria-label={active ? libraryStrings.filtersActive(active) : libraryStrings.filtersMenu}
          data-testid="library-filters-menu"
        >
          {active ? libraryStrings.filtersActive(active) : libraryStrings.filtersMenu}
        </Button>
      )}
    />
  );
}

/** Sub-bar under the header: reading-status chips, the "Filtros" menu and the sort order. */
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
      </div>
      <div className="library-bar__actions">
        <FiltersMenu browse={browse} />
        <SelectField
          label={libraryStrings.sortLabel}
          hideLabel
          options={sortOptions}
          value={browse.sort}
          onChange={(event) => browse.setSort(event.target.value as LibrarySort)}
          fieldClassName="o-field--sm library-bar__sort"
        />
      </div>
    </div>
  );
}
