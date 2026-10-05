import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { discoverStrings } from "../../strings/discover";
import { Layers } from "lucide-react";
import { Badge, IconButton, SelectField, cx } from "../../ui";
import { DiscoverSearchField } from "./DiscoverSearchField";

/** Discover order: title A–Z/Z–A, or by recent chapter, arrival, size, views or rating. */
export type SortDirection = "asc" | "desc" | "updated" | "new" | "chapters" | "popular" | "rating";

export { SEARCH_DEBOUNCE_MS } from "./DiscoverSearchField";

/**
 * Discover's PageHeader content: result count, search, source and sort. The filters live
 * in the bar above the results. A click on the header background dismisses a preview.
 */
export function discoverHeader({ discover, sources, loading, account }: AppControllers): ViewHeader {
  const { filters, setFilters, sortDirection, setSortDirection } = discover;
  const enabledSources = sources.sources.filter((source) => source.enabled);
  const busy = loading || discover.searching;

  return {
    badge: (
      <Badge aria-live="polite" data-testid="discover-count">
        {busy ? discoverStrings.searching : discoverStrings.resultsTotal(discover.results.length)}
      </Badge>
    ),
    search: (
      <DiscoverSearchField
        filters={filters}
        onFiltersChange={setFilters}
        catalogIndex={discover.catalogIndex}
        sourceIds={enabledSources.map((source) => source.id)}
        onOpenNovel={discover.openPreviewNovel}
        ai={{
          available: account.available,
          loggedIn: account.loggedIn,
          connecting: account.connecting,
          busy: discover.smartBusy,
          onAsk: discover.askSmart,
          onConnectAndAsk: (request) => {
            discover.askSmartAfterLogin(request);
            void account.connect();
          }
        }}
      />
    ),
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
        <SelectField<SortDirection>
          label={discoverStrings.sortLabel}
          hideLabel
          fieldClassName="o-field--sm discover-header__sort"
          value={sortDirection}
          disabled={filters.query.trim().length > 0}
          title={filters.query.trim() ? discoverStrings.sortByRelevance : undefined}
          options={discoverStrings.sortOptions}
          onChange={(event) => setSortDirection(event.target.value as SortDirection)}
        />
        <IconButton
          label={discover.stacks ? discoverStrings.stacksOff : discoverStrings.stacksOn}
          icon={<Layers />}
          size="sm"
          variant="ghost"
          className={cx("discover-stacks-toggle", discover.stacks && "is-on")}
          aria-pressed={discover.stacks}
          data-testid="discover-stacks-toggle"
          onClick={discover.toggleStacks}
        />
      </>
    ),
    onBackgroundClick: discover.previewNovel ? discover.clearPreviewNovel : undefined
  };
}
