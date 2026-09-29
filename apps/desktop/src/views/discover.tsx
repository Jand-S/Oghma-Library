import {
  ArrowDownAZ,
  ArrowUpAZ,
  Ban,
  BookOpen,
  Check,
  Download,
  Headphones,
  LayoutGrid,
  List,
  Minus,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Tags
} from "lucide-react";
import {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { statusLabel } from "../constants/ui";
import {
  defaultFilters,
  defaultSelection,
  estimateChapters,
  selectionLabel
} from "../core/defaults";
import {
  cycleTagState,
  tagLabel,
  tagSearchMatches,
  type TagFilterDraft
} from "../core/tagFilters";
import type {
  ChapterSelection,
  DownloadFormat,
  Filters,
  Novel,
  SourceSite,
  TagCatalogItem,
  TagCategory
} from "../core/types";
import { downloadFormats } from "../core/types";
import { commonStrings } from "../strings/common";
import { discoverStrings } from "../strings/discover";

type DiscoverSidebarTab = "queue" | "details";
type ResultSortDirection = "asc" | "desc";
type ResultLayout = "grid" | "list";
const tagCategoryLabels: Record<TagCategory, string> = {
  format: "Formato",
  genre: "Genero",
  theme: "Tema"
};
const tagCategoryOrder: TagCategory[] = ["format", "genre", "theme"];
const contentRatingLabels = {
  safe: "Seguro",
  suggestive: "Sugestivo",
  erotic: "Erótico"
} as const;
const contentRatingIcons = {
  all: <ShieldCheck size={15} />,
  safe: <ShieldCheck size={15} />,
  suggestive: <Sparkles size={15} />,
  erotic: <span className="rating-text-icon">+18</span>
} as const;
const contentRatingCycle = ["all", "safe", "suggestive", "erotic"] as const;
const statusCycle = ["any", "ongoing", "complete", "paused"] as const;
const statusQuickLabels = {
  any: "Qualquer status",
  ongoing: statusLabel.ongoing,
  complete: statusLabel.complete,
  paused: statusLabel.paused
} as const;
const languageCycle = ["all", "pt-br", "en"] as const;
const languageQuickLabels = {
  all: "Todos os idiomas",
  "pt-br": "PT-BR",
  en: "EN"
} as const;

function nextCycleValue<T extends string>(cycle: readonly T[], value: T, skipFirst = false): T {
  const values = skipFirst ? cycle.slice(1) : cycle;
  const currentIndex = values.indexOf(value);
  return values[currentIndex >= 0 ? (currentIndex + 1) % values.length : 0] ?? value;
}
function TagStateIcon({ state }: { state: "include" | "exclude" | "neutral" }) {
  if (state === "include") return <Check size={12} />;
  if (state === "exclude") return <Ban size={12} />;
  return null;
}

function TagFilterSheet({
  catalog,
  filters,
  onApply,
  onClose
}: {
  catalog: TagCatalogItem[];
  filters: Filters;
  onApply: (filters: Filters) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Record<TagCategory, boolean>>({ format: false, genre: false, theme: false });
  const [draft, setDraft] = useState<TagFilterDraft>({
    includeTags: filters.includeTags,
    excludeTags: filters.excludeTags
  });

  useEffect(() => {
    setDraft({ includeTags: filters.includeTags, excludeTags: filters.excludeTags });
  }, [filters.includeTags, filters.excludeTags]);

  const activeCount = draft.includeTags.length + draft.excludeTags.length;
  const filteredCatalog = catalog.filter((tag) => tagSearchMatches(tag, query));
  const stateFor = (key: string): "include" | "exclude" | "neutral" => {
    if (draft.includeTags.includes(key)) return "include";
    if (draft.excludeTags.includes(key)) return "exclude";
    return "neutral";
  };
  const cycle = (key: string) => setDraft((current) => cycleTagState(current, key));
  const clearDraft = () => setDraft({ includeTags: [], excludeTags: [] });
  const applyDraft = () => onApply({ ...filters, includeTags: draft.includeTags, excludeTags: draft.excludeTags });

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div className="tag-sheet-scrim" onMouseDown={(event) => event.currentTarget === event.target ? onClose() : undefined}>
      <section className="tag-filter-sheet" aria-label="Escolher tags" onKeyDown={handleKeyDown} tabIndex={-1}>
        <div className="tag-sheet-header">
          <div>
            <h2>Tags</h2>
            <span>{activeCount === 0 ? "Nenhuma tag ativa" : `${draft.includeTags.length} obrigatorias, ${draft.excludeTags.length} proibidas`}</span>
          </div>
          <button className="button quiet compact" onClick={clearDraft}>Limpar</button>
        </div>
        <div className="input-with-icon tag-search-field">
          <Search size={16} />
          <input
            autoFocus
            aria-label="Buscar tags"
            placeholder="Buscar tags"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="tag-sheet-active">
          {draft.includeTags.map((key) => (
            <button className="tag-token include" key={key} onClick={() => cycle(key)} title="Clique para proibir esta tag">
              <Check size={12} />
              {tagLabel(key, catalog)}
            </button>
          ))}
          {draft.excludeTags.map((key) => (
            <button className="tag-token exclude" key={key} onClick={() => cycle(key)} title="Clique para remover esta tag">
              <Minus size={12} />
              {tagLabel(key, catalog)}
            </button>
          ))}
          {activeCount === 0 ? <span>Nenhuma tag escolhida</span> : null}
        </div>
        <div className="tag-section-list">
          {tagCategoryOrder.map((category) => {
            const sectionTags = filteredCatalog
              .filter((tag) => tag.category === category)
              .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
            const showAll = query.trim().length > 0 || expanded[category];
            const visible = showAll ? sectionTags : sectionTags.slice(0, 28);
            return (
              <section className="tag-section" key={category}>
                <div className="tag-section-title">
                  <h3>{tagCategoryLabels[category]}</h3>
                  {sectionTags.length > 28 && !query.trim() ? (
                    <button onClick={() => setExpanded((current) => ({ ...current, [category]: !current[category] }))}>
                      {expanded[category] ? "Ver populares" : `Ver todas (${sectionTags.length})`}
                    </button>
                  ) : null}
                </div>
                {visible.length > 0 ? (
                  <div className="tag-choice-grid">
                    {visible.map((tag) => {
                      const state = stateFor(tag.key);
                      const title = state === "neutral"
                        ? `Exigir ${tag.label}`
                        : state === "include"
                        ? `Proibir ${tag.label}`
                        : `Remover filtro ${tag.label}`;
                      return (
                        <button
                          className={`tag-choice ${state}`}
                          key={tag.key}
                          onClick={() => cycle(tag.key)}
                          aria-pressed={state !== "neutral"}
                          title={title}
                        >
                          <TagStateIcon state={state} />
                          <span>{tag.label}</span>
                          <small>{tag.count.toLocaleString("pt-BR")}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <p className="tag-empty">Nenhuma tag encontrada.</p>
                )}
              </section>
            );
          })}
        </div>
        <div className="tag-sheet-footer">
          <button className="button quiet" onClick={onClose}>Cancelar</button>
          <button className="button primary" onClick={applyDraft}>Aplicar tags</button>
        </div>
      </section>
    </div>
  );
}

function FiltersPanel({
  filters,
  sources,
  tagCatalog,
  onChange,
  onOpenTagEditor,
  onBackgroundClick
}: {
  filters: Filters;
  sources: SourceSite[];
  tagCatalog: TagCatalogItem[];
  onChange: (filters: Filters) => void;
  onOpenTagEditor: () => void;
  onBackgroundClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const changeSource = (sourceId: string) => onChange({ ...filters, sourceId, language: "all" });
  const activeTags = [...filters.includeTags.map((key) => ({ key, mode: "include" as const })), ...filters.excludeTags.map((key) => ({ key, mode: "exclude" as const }))];

  return (
    <aside className="filter-panel" data-testid="filter-panel" onClick={onBackgroundClick}>
      <div className="panel-header">
        <div>
          <h2>{commonStrings.filters}</h2>
          <span>Busca no acervo</span>
        </div>
      </div>

      <>
        <div className="field-group" data-testid="filter-field">
          <label htmlFor="query">{commonStrings.search}</label>
          <div className="input-with-icon">
            <Search size={16} />
            <input id="query" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} />
          </div>
        </div>

        <div className="tag-summary-block">
          <div className="tag-summary-head">
            <div>
              <strong>Tags</strong>
              <span>{filters.includeTags.length} obrigatorias, {filters.excludeTags.length} proibidas</span>
            </div>
            <button className="button quiet compact" onClick={onOpenTagEditor}>
              <Tags size={14} />
              Escolher
            </button>
          </div>
          <div className="tag-summary-pills">
            {activeTags.length === 0 ? <span className="muted-tag-pill">Sem filtro de tags</span> : null}
            {activeTags.slice(0, 6).map((tag) => (
              <span className={`tag-token ${tag.mode}`} key={`${tag.mode}-${tag.key}`}>
                {tag.mode === "include" ? <Check size={12} /> : <Minus size={12} />}
                {tagLabel(tag.key, tagCatalog)}
              </span>
            ))}
            {activeTags.length > 6 ? <span className="muted-tag-pill">+{activeTags.length - 6}</span> : null}
          </div>
        </div>

        <div className="field-group" data-testid="filter-field">
          <label htmlFor="source">{discoverStrings.source}</label>
          <select id="source" value={filters.sourceId} onChange={(event) => changeSource(event.target.value)} required>
            {sources.filter((source) => source.enabled).map((source) => (
              <option value={source.id} key={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group" data-testid="filter-field">
          <label htmlFor="language">Idioma</label>
          <select id="language" value={filters.language} onChange={(event) => setFilter("language", event.target.value)}>
            <option value="all">Todos</option>
            <option value="pt-br">PT-BR</option>
            <option value="en">EN</option>
          </select>
        </div>

        <div className="field-group" data-testid="filter-field">
          <label htmlFor="status">Status</label>
          <select id="status" value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
            <option value="any">Qualquer status</option>
            <option value="ongoing">Em andamento</option>
            <option value="complete">Completa</option>
            <option value="paused">Pausada</option>
          </select>
        </div>
      </>
    </aside>
  );
}

function NovelCard({
  novel,
  selected,
  focused,
  onToggle,
  onSelect,
  onPreview
}: {
  novel: Novel;
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const handleCheckClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onToggle();
  };

  const handleContextMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    onPreview();
  };

  return (
    <article
      className={`book-card ${selected ? "selected" : ""} ${focused ? "focused" : ""}`}
      data-testid="book-card"
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      <button
        className={`card-check ${selected ? "active" : ""}`}
        aria-label={selected ? discoverStrings.removeFromQueue(novel.title) : discoverStrings.selectForQueue(novel.title)}
        onClick={handleCheckClick}
      >
        {selected ? <Check size={11} /> : null}
      </button>
      <div
        className={`book-cover ${novel.coverClass}`}
        data-testid="book-cover"
        style={novel.coverUrl ? { backgroundImage: `url("${novel.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      />
      <div className="book-info">
        <strong>{novel.title}</strong>
        <small>{novel.author}</small>
        <p>
          {novel.chapters.toLocaleString("pt-BR")} capitulos - {novel.sourceName}
        </p>
      </div>
      <div className="book-meta">
        <span>{statusLabel[novel.status]}</span>
        <span>{novel.updatedAt}</span>
      </div>
    </article>
  );
}

function SkeletonGrid() {
  return (
    <div className="book-grid compact">
      {Array.from({ length: 12 }, (_, index) => (
        <div className="book-card skeleton-card" key={index}>
          <div />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function SelectionConfigurator({
  novel,
  selection,
  adding,
  inLibrary,
  queued,
  onChange,
  onAdd
}: {
  novel?: Novel;
  selection: ChapterSelection | null;
  adding: boolean;
  inLibrary: boolean;
  queued: boolean;
  onChange: (selection: ChapterSelection) => void;
  onAdd: () => void;
}) {
  const current = novel ? selection ?? defaultSelection(novel) : null;
  const update = (patch: Partial<ChapterSelection>) => {
    if (current) onChange({ ...current, ...patch });
  };
  const toggleFormat = (format: DownloadFormat) => {
    if (!current) return;
    const has = current.formats.includes(format);
    if (has && current.formats.length === 1) return;
    const next = has
      ? current.formats.filter((item) => item !== format)
      : downloadFormats.filter((item) => current.formats.includes(item) || item === format);
    update({ formats: next });
  };

  return (
    <section className="discover-sidebar-panel queue-panel" data-testid="queue-panel">
      <div className="panel-header">
        <div>
          <h2>{discoverStrings.queueHeading}</h2>
          <span>{novel ? discoverStrings.configureHint : discoverStrings.selectHint}</span>
        </div>
        <button
          className="button primary queue-add-button"
          data-testid="add-to-queue"
          disabled={!novel || adding}
          onClick={onAdd}
          aria-busy={adding}
        >
          <Download size={15} />
          {adding ? commonStrings.sending : inLibrary ? discoverStrings.downloadAgain : discoverStrings.addToQueue}
        </button>
      </div>
      {novel && (inLibrary || queued) ? (
        <p className="reorder-hint" data-testid="selection-hint">
          {queued ? discoverStrings.alreadyQueuedHint : discoverStrings.replaceHint}
        </p>
      ) : null}
      <div className="selection-list">
        {!novel || !current ? (
          <div className="empty-state compact">
            <BookOpen size={18} />
            <span>Clique em um card para configurar capitulos.</span>
          </div>
        ) : (
          <article className="selection-card expanded" data-testid="selection-card" data-card-id={novel.id}>
            <div className="selection-summary">
              <div className="selection-title">
                <strong>{novel.title}</strong>
                <small>{novel.chapters.toLocaleString("pt-BR")} capitulos</small>
              </div>
            </div>
            <div className="selection-body">
              <div className="segmented presets">
                {([["all", discoverStrings.presetAll], ["range", discoverStrings.presetRange]] as const).map(([value, label]) => (
                  <button
                    className={current.preset === value ? "active" : ""}
                    aria-pressed={current.preset === value}
                    key={value}
                    onClick={() =>
                      update(value === "range" ? { preset: "range", start: 1, end: novel.chapters } : { preset: "all" })
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
              {current.preset === "range" ? (
                <div className="chapter-range">
                  <label>
                    Inicio
                    <input
                      type="number"
                      min={1}
                      max={current.end}
                      value={current.start}
                      onChange={(event) => {
                        const raw = Number(event.target.value) || 1;
                        update({ start: Math.max(1, Math.min(raw, current.end)) });
                      }}
                    />
                  </label>
                  <label>
                    Fim
                    <input
                      type="number"
                      min={current.start}
                      max={novel.chapters}
                      value={current.end}
                      onChange={(event) => {
                        const raw = Number(event.target.value) || current.start;
                        update({ end: Math.min(novel.chapters, Math.max(raw, current.start)) });
                      }}
                    />
                  </label>
                </div>
              ) : null}
              <div className="format-group">
                <span className="field-caption">{commonStrings.formats}</span>
                <div className="format-options">
                  {downloadFormats.map((format) => (
                    <button
                      key={format}
                      className={`format-chip ${current.formats.includes(format) ? "active" : ""}`}
                      aria-pressed={current.formats.includes(format)}
                      onClick={() => toggleFormat(format)}
                    >
                      {format}
                    </button>
                  ))}
                </div>
              </div>
              <div className="selection-options single">
                <button
                  className={`option-toggle ${current.audiobook ? "active" : ""}`}
                  onClick={() => update({ audiobook: !current.audiobook })}
                  aria-pressed={current.audiobook}
                >
                  <Headphones size={14} />
                  {commonStrings.audiobook}
                </button>
              </div>
              <p>{selectionLabel(current, novel.chapters)} - {estimateChapters(current, novel.chapters).toLocaleString("pt-BR")} capitulos</p>
            </div>
          </article>
        )}
      </div>
    </section>
  );
}

function DiscoverDetailsPanel({
  novel,
  preview
}: {
  novel?: Novel;
  preview?: boolean;
}) {
  if (!novel) {
    return (
      <section className="discover-sidebar-panel discover-detail-panel empty" data-testid="discover-detail-panel">
        <div className="panel-header discover-detail-header">
          <div>
            <h2>Detalhes</h2>
            <span>Selecione uma novel para inspecionar</span>
          </div>
        </div>
        <div className="empty-state compact">
          <BookOpen size={18} />
          <span>Abra um card para ver capa, sinopse e metadados.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="discover-sidebar-panel discover-detail-panel" data-testid="discover-detail-panel">
      <div className="panel-header discover-detail-header">
        <div>
          <h2>Detalhes</h2>
          <span>{preview ? "Pre-visualizacao temporaria" : "Ultima novel selecionada"}</span>
        </div>
      </div>
      <div
        className={`book-cover detail-cover ${novel.coverClass}`}
        data-testid="detail-cover"
        style={novel.coverUrl ? { backgroundImage: `url("${novel.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
      />
      <div className="discover-detail-copy">
        <h3>{novel.title}</h3>
        <span>{novel.author}</span>
      </div>
      <div className="detail-stats">
        <span>{novel.sourceName}</span>
        <span>{statusLabel[novel.status]}</span>
        <span>{novel.language.toUpperCase()}</span>
        <span>{novel.chapters.toLocaleString("pt-BR")} capitulos</span>
        <span>{novel.updatedAt}</span>
      </div>
      {novel.tags.length > 0 ? (
        <div className="queue-badges discover-detail-tags">
          {novel.tags.map((tag) => (
            <span className="badge" key={tag}>{tag}</span>
          ))}
        </div>
      ) : null}
      <div className="discover-detail-section">
        <h3>{commonStrings.synopsis}</h3>
        <p>{novel.description.trim() || "Sem sinopse cadastrada para esta novel."}</p>
      </div>
    </section>
  );
}

export function DiscoverView({
  sources,
  filters,
  tagCatalog,
  results,
  selectedNovel,
  selection,
  loading,
  detailNovel,
  detailFromPreview,
  filterCollapsed,
  adding,
  selectedInLibrary,
  selectedQueued,
  onFiltersChange,
  onToggleFilters,
  onSelectNovel,
  onPreviewNovel,
  onClearPreview,
  onSelectionChange,
  onAddSelected
}: {
  sources: SourceSite[];
  filters: Filters;
  tagCatalog: TagCatalogItem[];
  results: Novel[];
  /** The single selected book (the configurator applies to it). */
  selectedNovel?: Novel;
  selection: ChapterSelection | null;
  loading: boolean;
  detailNovel?: Novel;
  detailFromPreview: boolean;
  filterCollapsed: boolean;
  adding: boolean;
  selectedInLibrary: boolean;
  selectedQueued: boolean;
  onFiltersChange: (filters: Filters) => void;
  onToggleFilters: () => void;
  /** Selects the book, or clears the selection when it is already selected. */
  onSelectNovel: (novel: Novel) => void;
  onPreviewNovel: (novel: Novel) => void;
  onClearPreview: () => void;
  onSelectionChange: (selection: ChapterSelection) => void;
  onAddSelected: () => void;
}) {
  const pageSize = 60;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [sidebarTab, setSidebarTab] = useState<DiscoverSidebarTab>("queue");
  const [tagEditorOpen, setTagEditorOpen] = useState(false);
  const [sortDirection, setSortDirection] = useState<ResultSortDirection>("asc");
  const [resultLayout, setResultLayout] = useState<ResultLayout>("grid");
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => setVisibleCount(pageSize), [results, sortDirection]);
  useEffect(() => {
    if (detailFromPreview) {
      contentRef.current?.focus();
    }
  }, [detailFromPreview]);
  useEffect(() => {
    if (!selectedNovel && !detailFromPreview) setSidebarTab("queue");
  }, [detailFromPreview, selectedNovel]);
  const sortedResults = useMemo(() => {
    return [...results].sort((a, b) => {
      const comparison = a.title.localeCompare(b.title, "pt-BR", { numeric: true, sensitivity: "base" });
      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [results, sortDirection]);
  const visibleResults = sortedResults.slice(0, visibleCount);
  const nextContentRating = nextCycleValue(contentRatingCycle, filters.contentRating);
  const nextQuickContentRating = nextCycleValue(contentRatingCycle, filters.contentRating, true);
  const contentRatingLabel = filters.contentRating === "all" ? "Sem filtro" : contentRatingLabels[filters.contentRating];
  const nextContentRatingLabel = nextContentRating === "all" ? "sem filtro" : contentRatingLabels[nextContentRating];
  const nextQuickContentRatingLabel = nextQuickContentRating === "all" ? "sem filtro" : contentRatingLabels[nextQuickContentRating];
  const cycleContentRating = () => onFiltersChange({ ...filters, contentRating: nextContentRating });
  const cycleQuickContentRating = () => onFiltersChange({ ...filters, contentRating: nextQuickContentRating });
  const enabledSources = sources.filter((source) => source.enabled);
  const currentSource = enabledSources.find((source) => source.id === filters.sourceId);
  const currentSourceIndex = Math.max(0, enabledSources.findIndex((source) => source.id === filters.sourceId));
  const nextSource = enabledSources.length > 0 ? enabledSources[(currentSourceIndex + 1) % enabledSources.length] : undefined;
  const cycleSource = () => {
    if (!nextSource || enabledSources.length < 2) return;
    onFiltersChange({ ...filters, sourceId: nextSource.id, language: "all" });
  };
  const nextStatus = nextCycleValue(statusCycle, filters.status as typeof statusCycle[number], true);
  const cycleStatus = () => onFiltersChange({ ...filters, status: nextStatus });
  const nextLanguage = nextCycleValue(languageCycle, filters.language as typeof languageCycle[number], true);
  const cycleLanguage = () => onFiltersChange({ ...filters, language: nextLanguage });
  const clearQuery = () => onFiltersChange({ ...filters, query: "" });
  const hasClearableFilters = filters.query.trim().length > 0
    || filters.status !== "any"
    || filters.language !== "all"
    || filters.contentRating !== "all"
    || filters.includeTags.length > 0
    || filters.excludeTags.length > 0;
  const handleSelectNovel = (novel: Novel) => {
    setSidebarTab("details");
    onSelectNovel(novel);
  };
  const handleToggleNovel = (novel: Novel) => {
    setSidebarTab("queue");
    onSelectNovel(novel);
  };
  const handlePreviewNovel = (novel: Novel) => {
    setSidebarTab("details");
    onPreviewNovel(novel);
  };
  const handleContentClick = (event: MouseEvent<HTMLElement>) => {
    if (!detailFromPreview) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest(".book-card, button, input, select, label, .selection-drawer, .filter-panel")
      || target.closest(".tag-filter-sheet")
      || target.tagName === "H2"
      || target.tagName === "SPAN"
      || target.tagName === "P"
      || target.tagName === "SMALL"
      || target.tagName === "STRONG"
    ) {
      return;
    }
    if (
      target.closest(".content-area")
      && (
        target.closest(".toolbar")
        || target.closest(".active-filter-row")
        || target.closest(".book-grid")
        || target.closest(".results-more")
      )
    ) {
      onClearPreview();
      return;
    }
    if (target === contentRef.current) {
      onClearPreview();
    }
  };
  const handleFilterBackgroundClick = (event: MouseEvent<HTMLElement>) => {
    if (!detailFromPreview) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (
      target.closest("button, input, select, label")
      || target.closest(".input-with-icon")
      || target.tagName === "H2"
      || target.tagName === "SPAN"
      || target.tagName === "P"
      || target.tagName === "SMALL"
      || target.tagName === "STRONG"
    ) {
      return;
    }
    if (target.closest(".filter-panel")) {
      onClearPreview();
    }
  };
  const handleContentKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!detailFromPreview) return;
    if (event.key === "Escape") {
      event.preventDefault();
      onClearPreview();
    }
  };
  return (
    <>
      {!filterCollapsed ? (
        <FiltersPanel
          filters={filters}
          sources={sources}
          tagCatalog={tagCatalog}
          onChange={onFiltersChange}
          onOpenTagEditor={() => setTagEditorOpen(true)}
          onBackgroundClick={handleFilterBackgroundClick}
        />
      ) : null}
      <section
        className="content-area"
        data-testid="content-area"
        ref={contentRef}
        tabIndex={detailFromPreview ? 0 : -1}
        onClick={handleContentClick}
        onKeyDown={handleContentKeyDown}
      >
        <div className="toolbar" data-testid="toolbar">
          <div>
            <h2>{discoverStrings.results}</h2>
            <span>
              {loading
                ? "Buscando..."
                : discoverStrings.resultCount(Math.min(visibleCount, results.length), results.length)}
            </span>
          </div>
          <div className="toolbar-actions">
            <button
              className={`toolbar-control content-rating-toolbar ${filters.contentRating !== "all" ? "active" : ""} ${filters.contentRating}`}
              onClick={cycleContentRating}
              title={`Classificação: ${contentRatingLabel}. Clique para ${nextContentRatingLabel}.`}
              aria-label={`Classificação: ${contentRatingLabel}. Clique para ${nextContentRatingLabel}.`}
            >
              {contentRatingIcons[filters.contentRating]}
            </button>
            <button
              className="toolbar-control"
              onClick={() => setSortDirection((direction) => direction === "asc" ? "desc" : "asc")}
              title={`Ordem alfabética ${sortDirection === "asc" ? "A-Z" : "Z-A"}`}
              aria-label={`Ordem alfabética ${sortDirection === "asc" ? "A-Z" : "Z-A"}`}
            >
              {sortDirection === "asc" ? <ArrowDownAZ size={16} /> : <ArrowUpAZ size={16} />}
            </button>
            <div className="toolbar-segmented" aria-label="Disposição dos cards">
              <button
                className={resultLayout === "grid" ? "active" : ""}
                onClick={() => setResultLayout("grid")}
                title="Cards"
                aria-label="Cards"
                aria-pressed={resultLayout === "grid"}
              >
                <LayoutGrid size={16} />
              </button>
              <button
                className={resultLayout === "list" ? "active" : ""}
                onClick={() => setResultLayout("list")}
                title="Lista compacta"
                aria-label="Lista compacta"
                aria-pressed={resultLayout === "list"}
              >
                <List size={16} />
              </button>
            </div>
          </div>
        </div>

        <div className="active-filter-row" data-testid="active-filter-row">
          <button
            className={`toolbar-control filter-row-toggle ${!filterCollapsed || hasClearableFilters ? "active" : ""}`}
            onClick={onToggleFilters}
            title={filterCollapsed ? commonStrings.showFilters : commonStrings.hideFilters}
            aria-label={filterCollapsed ? commonStrings.showFilters : commonStrings.hideFilters}
          >
            <SlidersHorizontal size={13} />
          </button>
          <button
            className={`quick-filter-pill ${enabledSources.length > 1 ? "cycleable" : ""}`}
            onClick={cycleSource}
            aria-disabled={enabledSources.length < 2}
            title={enabledSources.length > 1 ? `Fonte: ${currentSource?.name ?? "Fonte obrigatoria"}. Clique para ${nextSource?.name}.` : "Fonte obrigatoria"}
          >
            {currentSource?.name ?? "Fonte obrigatoria"}
          </button>
          {filters.query.trim() ? (
            <button
              className="quick-filter-pill clearable"
              onClick={clearQuery}
              title="Busca ativa. Clique para limpar."
            >
              Busca: {filters.query.trim()}
            </button>
          ) : null}
          {filters.status !== "any" ? (
            <button
              className="quick-filter-pill cycleable"
              onClick={cycleStatus}
              title={`Status: ${statusQuickLabels[filters.status as keyof typeof statusQuickLabels] ?? filters.status}. Clique para ${statusQuickLabels[nextStatus]}.`}
            >
              {statusQuickLabels[filters.status as keyof typeof statusQuickLabels] ?? filters.status}
            </button>
          ) : null}
          {filters.language !== "all" ? (
            <button
              className="quick-filter-pill cycleable"
              onClick={cycleLanguage}
              title={`Idioma: ${languageQuickLabels[filters.language as keyof typeof languageQuickLabels] ?? filters.language}. Clique para ${languageQuickLabels[nextLanguage]}.`}
            >
              {languageQuickLabels[filters.language as keyof typeof languageQuickLabels] ?? filters.language.toUpperCase()}
            </button>
          ) : null}
          {filters.contentRating !== "all" ? (
            <button
              className={`quick-filter-pill cycleable content-${filters.contentRating}`}
              onClick={cycleQuickContentRating}
              title={`Classificação: ${contentRatingLabel}. Clique para ${nextQuickContentRatingLabel}.`}
            >
              {contentRatingLabels[filters.contentRating]}
            </button>
          ) : null}
          {filters.includeTags.map((key) => <span className="include" key={`include-${key}`}>+ {tagLabel(key, tagCatalog)}</span>)}
          {filters.excludeTags.map((key) => <span className="exclude" key={`exclude-${key}`}>- {tagLabel(key, tagCatalog)}</span>)}
          {hasClearableFilters ? <button onClick={() => onFiltersChange(defaultFilters(filters.sourceId))}>Limpar</button> : null}
        </div>
        {tagEditorOpen ? (
          <TagFilterSheet
            catalog={tagCatalog}
            filters={filters}
            onApply={(next) => {
              onFiltersChange(next);
              setTagEditorOpen(false);
            }}
            onClose={() => setTagEditorOpen(false)}
          />
        ) : null}

        {loading ? (
          <SkeletonGrid />
        ) : results.length === 0 ? (
          <div className="results-empty-state">
            <strong>Nenhum resultado com esses filtros</strong>
            <span>Ajuste as tags, a fonte ou a Classificação.</span>
            <button className="button quiet" onClick={() => onFiltersChange(defaultFilters(filters.sourceId))}>Limpar filtros</button>
          </div>
        ) : (
          <div className={`book-grid compact ${resultLayout === "list" ? "list" : ""}`} data-testid="book-grid">
            {visibleResults.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                selected={selectedNovel?.id === novel.id}
                focused={detailNovel?.id === novel.id}
                onToggle={() => handleToggleNovel(novel)}
                onSelect={() => handleSelectNovel(novel)}
                onPreview={() => handlePreviewNovel(novel)}
              />
            ))}
            {visibleCount < results.length ? (
              <div className="results-more">
                <button className="button quiet" onClick={() => setVisibleCount((count) => count + pageSize)}>
                  {discoverStrings.showMore}
                </button>
              </div>
            ) : null}
          </div>
        )}

      </section>
      {selectedNovel || detailFromPreview ? (
        <aside className="selection-drawer discover-sidebar" data-testid="discover-sidebar">
          <div className="discover-sidebar-tabs" role="tablist" aria-label="Painel lateral da descoberta">
            <button
              className={`discover-sidebar-tab ${sidebarTab === "queue" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "queue"}
              disabled={!selectedNovel}
              onClick={() => setSidebarTab("queue")}
            >
              {commonStrings.queueTab}
            </button>
            <button
              className={`discover-sidebar-tab ${sidebarTab === "details" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "details"}
              disabled={!detailNovel}
              onClick={() => setSidebarTab("details")}
            >
              {commonStrings.detailsTab}
            </button>
          </div>
          {sidebarTab === "queue" ? (
            <SelectionConfigurator
              novel={selectedNovel}
              selection={selection}
              adding={adding}
              inLibrary={selectedInLibrary}
              queued={selectedQueued}
              onChange={onSelectionChange}
              onAdd={onAddSelected}
            />
          ) : (
            <DiscoverDetailsPanel novel={detailNovel} preview={detailFromPreview} />
          )}
        </aside>
      ) : null}
    </>
  );
}

