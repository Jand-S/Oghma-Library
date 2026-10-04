import { CornerDownLeft, Search, Sparkles, X } from "lucide-react";
import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { defaultFilters } from "../../core/defaults";
import type { Filters, Novel } from "../../core/types";
import { searchCatalog, type CatalogIndex } from "../../services/catalogIndex";
import { discoverStrings } from "../../strings/discover";
import { Cover, IconButton, Spinner, TextField, cx } from "../../ui";

/** Delay between the last keystroke and the search request. */
export const SEARCH_DEBOUNCE_MS = 120;
/** Title shortcuts listed under the AI row. */
const TITLE_SUGGESTIONS = 5;

export type SearchAi = {
  /** Tauri runtime with the ChatGPT engine (false in the browser build: the request runs locally). */
  available: boolean;
  loggedIn: boolean;
  connecting: boolean;
  busy: boolean;
  /** Runs the request (ChatGPT when logged in, local interpretation otherwise). */
  onAsk: (request: string) => void;
  /** Starts the ChatGPT login and runs the request once it completes. */
  onConnectAndAsk: (request: string) => void;
};

type DiscoverSearchFieldProps = {
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  catalogIndex: CatalogIndex | null;
  sourceIds: readonly string[];
  onOpenNovel: (novel: Novel) => void;
  ai: SearchAi;
};

type Option = { kind: "ai" } | { kind: "novel"; novel: Novel };

/**
 * Debounced title/author search with a Spotlight-style suggestion list: the first row
 * sends the text to the AI ("Pedir sugestões à IA"), the next ones open matching titles.
 * Enter searches (or activates the highlighted row); ⌘/Ctrl+Enter asks the AI.
 */
export function DiscoverSearchField({ filters, onFiltersChange, catalogIndex, sourceIds, onOpenNovel, ai }: DiscoverSearchFieldProps) {
  const [draft, setDraft] = useState(filters.query);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const listId = useId();

  // External changes (e.g. "Limpar", or the AI applying its filters) win over the draft.
  useEffect(() => setDraft(filters.query), [filters.query]);

  useEffect(() => {
    if (draft === filtersRef.current.query) return;
    const timer = window.setTimeout(() => onFiltersChange({ ...filtersRef.current, query: draft }), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, onFiltersChange]);

  const text = draft.trim();
  const titles = useMemo(() => {
    if (!catalogIndex || text.length < 2) return [];
    return searchCatalog(catalogIndex, { ...defaultFilters("all"), query: text }, sourceIds).slice(0, TITLE_SUGGESTIONS);
  }, [catalogIndex, sourceIds, text]);
  const options: Option[] = text.length >= 2 ? [{ kind: "ai" }, ...titles.map((novel) => ({ kind: "novel" as const, novel }))] : [];
  const showList = open && options.length > 0;

  useEffect(() => setActive(-1), [text]);

  const commitNow = (value: string) => {
    setDraft(value);
    if (value !== filtersRef.current.query) onFiltersChange({ ...filtersRef.current, query: value });
  };

  const askAi = () => {
    if (!text || ai.busy) return;
    setOpen(false);
    if (ai.available && !ai.loggedIn) ai.onConnectAndAsk(text);
    else ai.onAsk(text);
  };

  const activate = (option: Option) => {
    if (option.kind === "ai") {
      askAi();
      return;
    }
    setOpen(false);
    onOpenNovel(option.novel);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (index + 1) % options.length);
      return;
    }
    if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setActive((index) => (index <= 0 ? options.length - 1 : index - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (event.metaKey || event.ctrlKey) askAi();
      else if (showList && active >= 0) activate(options[active]);
      else {
        commitNow(draft);
        setOpen(false);
      }
      return;
    }
    if (event.key === "Escape") {
      if (showList) {
        event.preventDefault();
        setOpen(false);
      } else if (draft) {
        event.preventDefault();
        commitNow("");
      }
    }
  };

  const optionId = (index: number) => `${listId}-option-${index}`;
  const needsLogin = ai.available && !ai.loggedIn;

  return (
    <div className="discover-search">
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
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
        leading={<Search />}
        trailing={draft ? (
          <IconButton label={discoverStrings.clearSearch} icon={<X />} size="sm" variant="ghost" onClick={() => commitNow("")} />
        ) : null}
        onChange={(event) => {
          setDraft(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {showList ? (
        <div className="discover-search__popover" data-testid="discover-search-suggestions">
          <ul id={listId} role="listbox" aria-label={discoverStrings.suggestionsLabel} className="discover-search__list">
            {options.map((option, index) => {
              const selected = index === active;
              const common = {
                id: optionId(index),
                role: "option" as const,
                "aria-selected": selected,
                // Keep the focus in the field while clicking a row.
                onMouseDown: (event: MouseEvent) => event.preventDefault(),
                onMouseEnter: () => setActive(index),
                onClick: () => activate(option)
              };
              if (option.kind === "ai") {
                return (
                  <li key="ai" {...common} className={cx("discover-search__option discover-search__option--ai", selected && "is-active")} data-testid="discover-ask-ai">
                    <span className="discover-search__ai-icon" aria-hidden="true">
                      {ai.busy || ai.connecting ? <Spinner size="sm" /> : <Sparkles />}
                    </span>
                    <span className="discover-search__text">
                      <span className="discover-search__primary">
                        {needsLogin ? (ai.connecting ? discoverStrings.askAiConnecting : discoverStrings.askAiConnect) : discoverStrings.askAi}
                      </span>
                      <span className="discover-search__secondary">“{text}”</span>
                    </span>
                    {needsLogin && !ai.connecting ? (
                      <span className="discover-search__pill">{discoverStrings.askAiConnectAction}</span>
                    ) : (
                      <kbd className="discover-search__kbd" aria-hidden="true">⌘<CornerDownLeft /></kbd>
                    )}
                  </li>
                );
              }
              const { novel } = option;
              return (
                <Fragment key={novel.id}>
                  {index === 1 ? <li role="presentation" className="discover-search__heading">{discoverStrings.titlesHeading}</li> : null}
                  <li {...common} className={cx("discover-search__option", selected && "is-active")}>
                    <Cover src={novel.coverUrl} title={novel.title} size="fill" className="discover-search__cover" />
                    <span className="discover-search__text">
                      <span className="discover-search__primary">{novel.title}</span>
                      <span className="discover-search__secondary">
                        {[novel.author, novel.sourceName, discoverStrings.chaptersShort(novel.chapters)].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                  </li>
                </Fragment>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
