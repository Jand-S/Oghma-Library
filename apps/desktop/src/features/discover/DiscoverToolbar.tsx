import { ArrowDownAZ, ArrowUpAZ, Search, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Filters, SourceSite } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, IconButton, SelectField, TextField, cx } from "../../ui";

export type SortDirection = "asc" | "desc";

/** Delay between the last keystroke and the search request. */
export const SEARCH_DEBOUNCE_MS = 250;

type DiscoverToolbarProps = {
  filters: Filters;
  sources: SourceSite[];
  total: number;
  loading: boolean;
  sortDirection: SortDirection;
  filtersOpen: boolean;
  filterCount: number;
  onFiltersChange: (filters: Filters) => void;
  onSortChange: (direction: SortDirection) => void;
  onToggleFilters: () => void;
};

/** Source, debounced search, result count, sort and the "Filtros" drawer toggle. */
export function DiscoverToolbar({
  filters,
  sources,
  total,
  loading,
  sortDirection,
  filtersOpen,
  filterCount,
  onFiltersChange,
  onSortChange,
  onToggleFilters
}: DiscoverToolbarProps) {
  const enabledSources = sources.filter((source) => source.enabled);
  const [draft, setDraft] = useState(filters.query);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  // External changes (e.g. "Limpar") win over the draft.
  useEffect(() => setDraft(filters.query), [filters.query]);

  useEffect(() => {
    if (draft === filtersRef.current.query) return;
    const timer = window.setTimeout(() => onFiltersChange({ ...filtersRef.current, query: draft }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, onFiltersChange]);

  const commitNow = (value: string) => {
    setDraft(value);
    if (value !== filtersRef.current.query) onFiltersChange({ ...filtersRef.current, query: value });
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commitNow(draft);
  };

  const sortLabel = sortDirection === "asc" ? discoverStrings.sortAsc : discoverStrings.sortDesc;

  return (
    <div className="discover-toolbar" data-testid="toolbar">
      <SelectField
        label={discoverStrings.source}
        hideLabel
        fieldClassName="discover-toolbar__source"
        value={filters.sourceId}
        required
        options={enabledSources.map((source) => ({ value: source.id, label: source.name }))}
        onChange={(event) => onFiltersChange({ ...filters, sourceId: event.target.value, language: "all" })}
      />
      <TextField
        label={discoverStrings.search}
        hideLabel
        fieldClassName="discover-toolbar__search"
        placeholder={discoverStrings.searchPlaceholder}
        data-testid="discover-search"
        value={draft}
        autoComplete="off"
        spellCheck={false}
        leading={<Search />}
        trailing={draft ? (
          <IconButton
            className="discover-toolbar__clear"
            label={discoverStrings.clearSearch}
            icon={<X />}
            size="sm"
            onClick={() => commitNow("")}
          />
        ) : null}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={onSearchKeyDown}
      />
      <Badge className="discover-toolbar__count" aria-live="polite">
        {loading ? discoverStrings.searching : discoverStrings.resultsTotal(total)}
      </Badge>
      <div className="discover-toolbar__spacer" />
      <IconButton
        label={sortLabel}
        icon={sortDirection === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
        variant="ghost"
        onClick={() => onSortChange(sortDirection === "asc" ? "desc" : "asc")}
      />
      <Button
        variant="outline"
        className={cx("discover-toolbar__filters", filtersOpen && "is-active")}
        icon={<SlidersHorizontal />}
        aria-expanded={filtersOpen}
        aria-controls="discover-filter-panel"
        onClick={onToggleFilters}
      >
        {discoverStrings.filtersToggle}
        {filterCount > 0 ? <Badge tone="accent" className="discover-toolbar__filter-count">{filterCount}</Badge> : null}
      </Button>
    </div>
  );
}
