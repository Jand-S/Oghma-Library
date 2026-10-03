import { ArrowDownAZ, ArrowUpAZ, Search, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import type { Filters } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Badge, IconButton, SelectField, TextField } from "../../ui";

export type SortDirection = "asc" | "desc";

/** Delay between the last keystroke and the search request. */
export const SEARCH_DEBOUNCE_MS = 120;

type SearchFieldProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
};

/** Debounced title/author search; Enter searches right away. */
function DiscoverSearchField({ filters, onFiltersChange }: SearchFieldProps) {
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

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commitNow(draft);
    if (event.key === "Escape" && draft) {
      event.preventDefault();
      commitNow("");
    }
  };

  return (
    <TextField
      label={discoverStrings.search}
      hideLabel
      type="search"
      fieldClassName="o-field--sm"
      placeholder={discoverStrings.searchPlaceholder}
      data-testid="discover-search"
      value={draft}
      autoComplete="off"
      spellCheck={false}
      leading={<Search />}
      trailing={draft ? (
        <IconButton label={discoverStrings.clearSearch} icon={<X />} size="sm" variant="ghost" onClick={() => commitNow("")} />
      ) : null}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

/**
 * Discover's PageHeader content: result count, search, source and sort. The filters live
 * in the bar above the results. A click on the header background dismisses a preview.
 */
export function discoverHeader({ discover, sources, loading }: AppControllers): ViewHeader {
  const { filters, setFilters, sortDirection, setSortDirection } = discover;
  const enabledSources = sources.sources.filter((source) => source.enabled);
  const busy = loading || discover.searching;
  const sortLabel = sortDirection === "asc" ? discoverStrings.sortAsc : discoverStrings.sortDesc;

  return {
    badge: (
      <Badge aria-live="polite" data-testid="discover-count">
        {busy ? discoverStrings.searching : discoverStrings.resultsTotal(discover.results.length)}
      </Badge>
    ),
    search: <DiscoverSearchField filters={filters} onFiltersChange={setFilters} />,
    actions: (
      <>
        <SelectField
          label={discoverStrings.source}
          hideLabel
          fieldClassName="o-field--sm discover-header__source"
          value={filters.sourceId}
          required
          options={[{ value: "all", label: discoverStrings.allSources }, ...enabledSources.map((source) => ({ value: source.id, label: source.name }))]}
          onChange={(event) => setFilters({ ...filters, sourceId: event.target.value, language: "all" })}
        />
        <IconButton
          label={sortLabel}
          icon={sortDirection === "asc" ? <ArrowDownAZ /> : <ArrowUpAZ />}
          variant="ghost"
          size="sm"
          onClick={() => setSortDirection(sortDirection === "asc" ? "desc" : "asc")}
        />
      </>
    ),
    onBackgroundClick: discover.previewNovel ? discover.clearPreviewNovel : undefined
  };
}
