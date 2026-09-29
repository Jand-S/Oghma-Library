import { Ban, Check, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type WheelEvent } from "react";
import { tagSearchMatches } from "../../core/tagFilters";
import type { ContentRatingFilter, Filters, TagCatalogItem, TagCategory } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Button, Chip, SegmentedControl, TextField, cx } from "../../ui";
import { FilterPopover } from "./FilterPopover";
import {
  CHAPTERS_MAX_DEFAULT,
  CHAPTERS_MIN_DEFAULT,
  activeFilters,
  chapterBounds,
  chapterPresets,
  chaptersValue,
  cycleTag,
  languageOptions,
  optionLabel,
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

const parseChapter = (value: string) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

type FilterBarProps = {
  filters: Filters;
  tagCatalog: TagCatalogItem[];
  /** Adds a divider under the bar once the results scroll beneath it. */
  scrolled: boolean;
  onChange: (filters: Filters) => void;
  onClear: () => void;
};

/**
 * Compact bar above the results: one pill per filter, each opening an anchored popover,
 * followed by the removable chips of the active filters and "Limpar tudo". It lives outside
 * the scrolling grid, so it is always reachable.
 */
export function DiscoverFilterBar({ filters, tagCatalog, scrolled, onChange, onClear }: FilterBarProps) {
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const tagCount = filters.includeTags.length + filters.excludeTags.length;

  return (
    <div
      className={cx("discover-filterbar", scrolled && "is-scrolled")}
      data-testid="filter-panel"
      role="group"
      aria-label={discoverStrings.filtersHeading}
    >
      <div className="discover-filterbar__triggers">
        <FilterPopover
          label={discoverStrings.status}
          value={filters.status !== "any" ? optionLabel(statusOptions, filters.status) : undefined}
        >
          {(close) => (
            <OptionList
              label={discoverStrings.status}
              options={statusOptions}
              value={filters.status}
              onPick={(value) => {
                set("status", value);
                close();
              }}
            />
          )}
        </FilterPopover>
        <FilterPopover
          label={discoverStrings.language}
          value={filters.language !== "all" ? optionLabel(languageOptions, filters.language) : undefined}
        >
          {(close) => (
            <OptionList
              label={discoverStrings.language}
              options={languageOptions}
              value={filters.language}
              onPick={(value) => {
                set("language", value);
                close();
              }}
            />
          )}
        </FilterPopover>
        <FilterPopover
          label={discoverStrings.contentRating}
          value={filters.contentRating !== "all" ? optionLabel(ratingOptions, filters.contentRating) : undefined}
        >
          {(close) => (
            <OptionList<ContentRatingFilter>
              label={discoverStrings.contentRating}
              options={ratingOptions}
              value={filters.contentRating}
              onPick={(value) => {
                set("contentRating", value);
                close();
              }}
            />
          )}
        </FilterPopover>
        <FilterPopover label={discoverStrings.chapters} value={chaptersValue(filters) ?? undefined} size="md">
          {(close) => <ChaptersFilter filters={filters} onChange={onChange} onDone={close} />}
        </FilterPopover>
        <FilterPopover
          label={discoverStrings.tags}
          value={tagCount > 0 ? tagCount.toLocaleString("pt-BR") : undefined}
          separator=" · "
          size="lg"
        >
          {() => <TagPicker filters={filters} catalog={tagCatalog} onChange={onChange} />}
        </FilterPopover>
      </div>
      <ActiveFilterRow filters={filters} tagCatalog={tagCatalog} onChange={onChange} onClear={onClear} />
    </div>
  );
}

type Option<T extends string> = { value: T; label: string };

/** Single-choice list (radio semantics, ↑/↓ move focus); picking a value applies it. */
function OptionList<T extends string>({
  label,
  options,
  value,
  onPick
}: {
  label: string;
  options: ReadonlyArray<Option<T>>;
  value: T | null;
  onPick: (value: T) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const checkedIndex = options.findIndex((option) => option.value === value);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const radios = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("[role='radio']") ?? []);
    const current = radios.indexOf(document.activeElement as HTMLButtonElement);
    const last = radios.length - 1;
    const next = event.key === "Home" ? 0
      : event.key === "End" ? last
      : event.key === "ArrowDown" ? (current + 1) % radios.length
      : (current - 1 + radios.length) % radios.length;
    radios[next]?.focus();
  };

  return (
    <div className="discover-options" role="radiogroup" aria-label={label} ref={listRef} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const checked = index === checkedIndex;
        const focusable = checked || (checkedIndex === -1 && index === 0);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={focusable ? 0 : -1}
            data-autofocus={focusable ? "" : undefined}
            className={cx("discover-option", checked && "is-checked")}
            onClick={() => onPick(option.value)}
          >
            <span className="discover-option__label">{option.label}</span>
            {checked ? <Check className="discover-option__check" aria-hidden="true" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Chapter presets plus a custom min/max range. */
function ChaptersFilter({ filters, onChange, onDone }: { filters: Filters; onChange: (filters: Filters) => void; onDone: () => void }) {
  const { min, max } = chapterBounds(filters);
  const current = chapterPresets.find((preset) => preset.min === min && preset.max === max)?.value ?? null;

  return (
    <div className="discover-popover__stack">
      <OptionList
        label={discoverStrings.chapters}
        options={chapterPresets}
        value={current}
        onPick={(value) => {
          const preset = chapterPresets.find((item) => item.value === value);
          if (!preset) return;
          onChange({
            ...filters,
            minChapters: preset.min ?? CHAPTERS_MIN_DEFAULT,
            maxChapters: preset.max ?? CHAPTERS_MAX_DEFAULT
          });
          onDone();
        }}
      />
      <div className="discover-popover__section">
        <span className="discover-popover__label" aria-hidden="true">{discoverStrings.chaptersCustom}</span>
        <div className="discover-popover__range">
          <TextField
            label={discoverStrings.chaptersMin}
            hideLabel
            fieldClassName="o-field--sm"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={discoverStrings.chaptersMinPlaceholder}
            value={min ?? ""}
            onChange={(event) => onChange({ ...filters, minChapters: parseChapter(event.target.value) ?? CHAPTERS_MIN_DEFAULT })}
          />
          <span className="discover-popover__range-sep" aria-hidden="true">–</span>
          <TextField
            label={discoverStrings.chaptersMax}
            hideLabel
            fieldClassName="o-field--sm"
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={discoverStrings.chaptersMaxPlaceholder}
            value={max ?? ""}
            onChange={(event) => onChange({ ...filters, maxChapters: parseChapter(event.target.value) ?? CHAPTERS_MAX_DEFAULT })}
          />
        </div>
      </div>
    </div>
  );
}

/** Tag search, category tabs and a scrollable list of tri-state chips. */
function TagPicker({ filters, catalog, onChange }: { filters: Filters; catalog: TagCatalogItem[]; onChange: (filters: Filters) => void }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<TagCategoryFilter>("all");
  const inUse = filters.includeTags.length + filters.excludeTags.length;

  const visible = useMemo(
    () => catalog
      .filter((tag) => (category === "all" || tag.category === category) && tagSearchMatches(tag, query))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")),
    [catalog, category, query]
  );

  return (
    <div className="discover-popover__stack discover-tags">
      <div className="discover-tags__tools">
        <TextField
          label={discoverStrings.tagSearch}
          hideLabel
          fieldClassName="o-field--sm discover-tags__search"
          placeholder={discoverStrings.tagSearch}
          leading={<Search />}
          value={query}
          autoComplete="off"
          spellCheck={false}
          data-autofocus=""
          onChange={(event) => setQuery(event.target.value)}
        />
        <SegmentedControl<TagCategoryFilter>
          aria-label={discoverStrings.tagCategory}
          size="sm"
          options={tagCategoryOptions}
          value={category}
          onChange={setCategory}
        />
      </div>
      {visible.length > 0 ? (
        <div className="discover-tags__list" role="group" aria-label={discoverStrings.tags}>
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
        <p className="discover-tags__empty">{discoverStrings.tagsEmpty}</p>
      )}
      <div className="discover-tags__footer">
        <p className="discover-tags__hint">{discoverStrings.tagsHint}</p>
        <Button
          variant="ghost"
          size="sm"
          className="discover-link"
          disabled={inUse === 0}
          onClick={() => onChange({ ...filters, includeTags: [], excludeTags: [] })}
        >
          {discoverStrings.clearTags}
        </Button>
      </div>
    </div>
  );
}

/** Removable chips for every active filter, plus "Limpar tudo". Hidden when nothing is set. */
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
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ start: false, end: false });

  const updateOverflow = useCallback(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const start = node.scrollLeft > 1;
    const end = node.scrollLeft + node.clientWidth < node.scrollWidth - 1;
    setOverflow((current) => (current.start === start && current.end === end ? current : { start, end }));
  }, []);

  useLayoutEffect(updateOverflow, [items.length, updateOverflow]);
  useEffect(() => {
    const node = scrollerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateOverflow);
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length > 0, updateOverflow]);

  if (items.length === 0) return null;

  // A mouse wheel scrolls the one-line strip sideways.
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    const node = scrollerRef.current;
    if (!node || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    node.scrollLeft += event.deltaY;
  };

  return (
    <div className="discover-active" data-testid="active-filter-row" role="group" aria-label={discoverStrings.activeFilters}>
      <div
        ref={scrollerRef}
        className={cx("discover-active__chips", overflow.start && "has-start", overflow.end && "has-end")}
        onScroll={updateOverflow}
        onWheel={onWheel}
      >
      {items.map((item) => (
        <Chip
          key={item.id}
          className="discover-active__chip"
          tone={item.kind === "exclude" ? "danger" : item.kind === "include" ? "accent" : "neutral"}
          icon={item.kind === "include" ? <Check /> : item.kind === "exclude" ? <Ban /> : undefined}
          removeLabel={discoverStrings.removeFilter(item.label)}
          onRemove={() => onChange(item.remove(filters))}
        >
          {item.label}
        </Chip>
      ))}
      </div>
      <Button variant="ghost" size="sm" className="discover-link" onClick={onClear}>{discoverStrings.clearAll}</Button>
    </div>
  );
}
