import { Heart, LayoutGrid, List, RefreshCw, Search, X } from "lucide-react";
import type { DownloadFormat } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Badge, Chip, IconButton, SegmentedControl, SelectField, TextField } from "../../ui";
import type { LibrarySort, LibraryViewMode } from "./libraryModel";

type LibraryToolbarProps = {
  total: number;
  shown: number;
  query: string;
  onQueryChange: (value: string) => void;
  formats: DownloadFormat[];
  selectedFormats: ReadonlySet<DownloadFormat>;
  onToggleFormat: (format: DownloadFormat) => void;
  favoritesOnly: boolean;
  onToggleFavorites: () => void;
  sort: LibrarySort;
  onSortChange: (sort: LibrarySort) => void;
  view: LibraryViewMode;
  onViewChange: (view: LibraryViewMode) => void;
  onRefresh: () => void;
};

const sortOptions = [
  { value: "recent", label: libraryStrings.sortRecent },
  { value: "title", label: libraryStrings.sortTitle },
  { value: "size", label: libraryStrings.sortSize }
] as const;

/** Search, format filters, sort, grid/list toggle and refresh, right under the page header. */
export function LibraryToolbar({
  total,
  shown,
  query,
  onQueryChange,
  formats,
  selectedFormats,
  onToggleFormat,
  favoritesOnly,
  onToggleFavorites,
  sort,
  onSortChange,
  view,
  onViewChange,
  onRefresh
}: LibraryToolbarProps) {
  const filtered = shown !== total;
  return (
    <div className="library-toolbar" data-testid="library-toolbar">
      <div className="library-toolbar__main">
        <Badge tone={filtered ? "accent" : "neutral"} className="library-toolbar__count" data-testid="library-count">
          {filtered ? libraryStrings.countFiltered(shown, total) : libraryStrings.count(total)}
        </Badge>
        <TextField
          label={libraryStrings.searchLabel}
          hideLabel
          type="search"
          placeholder={libraryStrings.searchPlaceholder}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query) {
              event.preventDefault();
              onQueryChange("");
            }
          }}
          leading={<Search aria-hidden="true" />}
          trailing={query ? (
            <IconButton label={libraryStrings.clearSearch} icon={<X />} size="sm" onClick={() => onQueryChange("")} />
          ) : undefined}
          data-testid="library-search"
          fieldClassName="library-toolbar__search"
        />
        <div className="library-toolbar__filters" role="group" aria-label={libraryStrings.formatFilterLabel}>
          {formats.map((format) => (
            <Chip key={format} selected={selectedFormats.has(format)} onToggle={() => onToggleFormat(format)}>
              {format}
            </Chip>
          ))}
          <Chip selected={favoritesOnly} onToggle={onToggleFavorites} icon={<Heart />}>
            {libraryStrings.favoritesFilter}
          </Chip>
        </div>
      </div>
      <div className="library-toolbar__side">
        <SelectField
          label={libraryStrings.sortLabel}
          hideLabel
          options={sortOptions}
          value={sort}
          onChange={(event) => onSortChange(event.target.value as LibrarySort)}
          fieldClassName="library-toolbar__sort"
        />
        <SegmentedControl
          aria-label={libraryStrings.viewLabel}
          size="sm"
          value={view}
          onChange={onViewChange}
          options={[
            { value: "grid", label: <span className="sr-only">{libraryStrings.viewGrid}</span>, icon: <LayoutGrid /> },
            { value: "list", label: <span className="sr-only">{libraryStrings.viewList}</span>, icon: <List /> }
          ]}
        />
        <IconButton label={libraryStrings.refresh} icon={<RefreshCw />} size="sm" variant="outline" onClick={onRefresh} />
      </div>
    </div>
  );
}
