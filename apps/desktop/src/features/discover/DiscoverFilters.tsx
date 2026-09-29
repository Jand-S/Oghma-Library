import { Ban, Check, Search } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { tagSearchMatches } from "../../core/tagFilters";
import type { ContentRatingFilter, Filters, TagCatalogItem, TagCategory } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Button, Chip, SegmentedControl, SelectField, TextField, cx } from "../../ui";
import {
  CHAPTERS_MAX_DEFAULT,
  CHAPTERS_MIN_DEFAULT,
  activeFilters,
  chapterBounds,
  cycleTag,
  languageOptions,
  ratingOptions,
  statusOptions,
  tagStateFor
} from "./filterModel";

type TagCategoryFilter = TagCategory | "all";

const tagCategoryOptions: Array<{ value: TagCategoryFilter; label: string }> = [
  { value: "all", label: discoverStrings.tagCategoryAll },
  { value: "genre", label: discoverStrings.tagCategoryGenre },
  { value: "theme", label: discoverStrings.tagCategoryTheme },
  { value: "format", label: discoverStrings.tagCategoryFormat }
];

/** Tags shown before "Ver todas". */
const POPULAR_TAGS = 32;

const parseChapter = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

type DiscoverFiltersProps = {
  filters: Filters;
  tagCatalog: TagCatalogItem[];
  clearable: boolean;
  onChange: (filters: Filters) => void;
  onClear: () => void;
};

/** Top drawer with status, language, rating, chapter range and tri-state tag chips. */
export function DiscoverFilters({ filters, tagCatalog, clearable, onChange, onClear }: DiscoverFiltersProps) {
  const headingId = useId();
  const { min, max } = chapterBounds(filters);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });

  return (
    <section
      id="discover-filter-panel"
      className="discover-filters"
      data-testid="filter-panel"
      aria-labelledby={headingId}
    >
      <header className="discover-filters__header">
        <div>
          <h2 className="discover-filters__title" id={headingId}>{discoverStrings.filtersHeading}</h2>
          <p className="discover-filters__description">{discoverStrings.filtersDescription}</p>
        </div>
        <Button variant="ghost" size="sm" disabled={!clearable} onClick={onClear}>
          {discoverStrings.clearFilters}
        </Button>
      </header>

      <div className="discover-filters__fields">
        <div className="discover-filters__field" data-testid="filter-field">
          <SelectField
            label={discoverStrings.status}
            options={statusOptions}
            value={filters.status}
            onChange={(event) => set("status", event.target.value)}
          />
        </div>
        <div className="discover-filters__field" data-testid="filter-field">
          <SelectField
            label={discoverStrings.language}
            options={languageOptions}
            value={filters.language}
            onChange={(event) => set("language", event.target.value)}
          />
        </div>
        <div className="discover-filters__field discover-filters__field--rating" data-testid="filter-field">
          <span className="discover-filters__label" aria-hidden="true">{discoverStrings.contentRating}</span>
          <SegmentedControl<ContentRatingFilter>
            aria-label={discoverStrings.contentRating}
            options={ratingOptions}
            value={filters.contentRating}
            onChange={(value) => set("contentRating", value)}
          />
        </div>
        <div className="discover-filters__field" data-testid="filter-field">
          <span className="discover-filters__label" aria-hidden="true">{discoverStrings.chapters}</span>
          <div className="discover-filters__range">
            <TextField
              label={discoverStrings.chaptersMin}
              hideLabel
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={discoverStrings.chaptersMinPlaceholder}
              value={min ?? ""}
              onChange={(event) => set("minChapters", parseChapter(event.target.value) ?? CHAPTERS_MIN_DEFAULT)}
            />
            <span className="discover-filters__range-sep" aria-hidden="true">–</span>
            <TextField
              label={discoverStrings.chaptersMax}
              hideLabel
              type="number"
              inputMode="numeric"
              min={1}
              placeholder={discoverStrings.chaptersMaxPlaceholder}
              value={max ?? ""}
              onChange={(event) => set("maxChapters", parseChapter(event.target.value) ?? CHAPTERS_MAX_DEFAULT)}
            />
          </div>
        </div>
      </div>

      <TagPicker filters={filters} catalog={tagCatalog} onChange={onChange} />
    </section>
  );
}

function TagPicker({ filters, catalog, onChange }: { filters: Filters; catalog: TagCatalogItem[]; onChange: (filters: Filters) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TagCategoryFilter>("all");
  const [expanded, setExpanded] = useState(false);

  const matching = useMemo(
    () => catalog
      .filter((tag) => (category === "all" || tag.category === category) && tagSearchMatches(tag, query))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")),
    [catalog, category, query]
  );
  const showAll = expanded || query.trim().length > 0;
  // Tags already in use stay visible even when they are not among the popular ones.
  const visible = showAll
    ? matching
    : matching.filter((tag, index) => index < POPULAR_TAGS || tagStateFor(filters, tag.key) !== "neutral");

  return (
    <div className="discover-filters__tags" data-testid="filter-field">
      <div className="discover-filters__tags-head">
        <div>
          <h3 className="discover-filters__label">{discoverStrings.tags}</h3>
          <p className="discover-filters__hint">{discoverStrings.tagsHint}</p>
        </div>
        <div className="discover-filters__tags-tools">
          <SegmentedControl<TagCategoryFilter>
            aria-label={discoverStrings.tagCategory}
            size="sm"
            options={tagCategoryOptions}
            value={category}
            onChange={setCategory}
          />
          <TextField
            label={discoverStrings.tagSearch}
            hideLabel
            fieldClassName="discover-filters__tag-search"
            placeholder={discoverStrings.tagSearch}
            leading={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      </div>
      {visible.length > 0 ? (
        <div className="discover-filters__tag-list" role="group" aria-label={discoverStrings.tags}>
          {visible.map((tag) => {
            const state = tagStateFor(filters, tag.key);
            return (
              <Chip
                key={tag.key}
                className={cx("discover-tag", state === "exclude" && "is-excluded")}
                selected={state !== "neutral"}
                icon={state === "include" ? <Check /> : state === "exclude" ? <Ban /> : undefined}
                onToggle={() => onChange(cycleTag(filters, tag.key))}
              >
                {tag.label}
                <span className="discover-tag__count" aria-hidden="true">{tag.count.toLocaleString("pt-BR")}</span>
                {state !== "neutral" ? (
                  <span className="sr-only">{`, ${state === "include" ? discoverStrings.tagIncluded : discoverStrings.tagExcluded}`}</span>
                ) : null}
              </Chip>
            );
          })}
        </div>
      ) : (
        <p className="discover-filters__hint">{discoverStrings.tagsEmpty}</p>
      )}
      {!query.trim() && matching.length > POPULAR_TAGS ? (
        <Button variant="ghost" size="sm" className="discover-filters__more" onClick={() => setExpanded((value) => !value)}>
          {expanded ? discoverStrings.tagsShowPopular : discoverStrings.tagsShowAll(matching.length)}
        </Button>
      ) : null}
    </div>
  );
}

/** Row of removable chips for every active filter, plus "Limpar". Hidden when nothing is set. */
export function ActiveFilterRow({
  filters,
  tagCatalog,
  onChange,
  onClear
}: {
  filters: Filters;
  tagCatalog: TagCatalogItem[];
  onChange: (filters: Filters) => void;
  onClear: () => void;
}) {
  const items = activeFilters(filters, tagCatalog);
  if (items.length === 0) return null;
  return (
    <div className="discover-active" data-testid="active-filter-row" role="group" aria-label={discoverStrings.activeFilters}>
      {items.map((item) => (
        <Chip
          key={item.id}
          tone={item.kind === "exclude" ? "danger" : item.kind === "include" ? "accent" : "neutral"}
          icon={item.kind === "include" ? <Check /> : item.kind === "exclude" ? <Ban /> : undefined}
          removeLabel={discoverStrings.removeFilter(item.label)}
          onRemove={() => onChange(item.remove(filters))}
        >
          {item.label}
        </Chip>
      ))}
      <Button variant="ghost" size="sm" onClick={onClear}>{discoverStrings.clear}</Button>
    </div>
  );
}
