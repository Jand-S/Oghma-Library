import { MouseEvent, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  GripVertical,
  Headphones,
  Home,
  Languages,
  Library,
  Loader2,
  Minus,
  Pause,
  Play,
  RefreshCcw,
  Search,
  Settings,
  CheckSquare,
  SlidersHorizontal,
  Square,
  Trash2,
  X
} from "lucide-react";
import { defaultAppConfig } from "../appConfig";
import { downloadFormats } from "../types";
import { defaultFilters, defaultSelection, estimateChapters, selectionLabel } from "../mockBackend";
import type {
  AppConfig,
  ChapterSelection,
  DownloadFormat,
  Filters,
  IndexMode,
  LibraryItem,
  Novel,
  QueueItem,
  ServerProbe,
  SourceSite,
  TranslationEngine,
  ViewId
} from "../types";
import { runWindowAction } from "../windowControls";
import {
  indexModeOptions,
  onboardingSteps,
  pageTitle,
  statusLabel,
  tags,
  translationEngineOptions,
  views,
  type SetupSyncEntry
} from "../constants/ui";

function FiltersPanel({
  filters,
  sources,
  onChange
}: {
  filters: Filters;
  sources: SourceSite[];
  onChange: (filters: Filters) => void;
}) {
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const toggleTag = (tag: string) => {
    setFilter("tags", filters.tags.includes(tag) ? filters.tags.filter((item) => item !== tag) : [...filters.tags, tag]);
  };

  return (
    <aside className="filter-panel">
      <div className="panel-header">
        <div>
          <h2>Filtros</h2>
          <span>Busca no acervo</span>
        </div>
      </div>

      <>
        <div className="field-group">
          <label htmlFor="query">Busca</label>
          <div className="input-with-icon">
            <Search size={16} />
            <input id="query" value={filters.query} onChange={(event) => setFilter("query", event.target.value)} />
          </div>
        </div>

        <div className="field-group">
          <label htmlFor="source">Fonte</label>
          <select id="source" value={filters.sourceId} onChange={(event) => setFilter("sourceId", event.target.value)}>
            <option value="all">Todos os sites</option>
            {sources.map((source) => (
              <option value={source.id} key={source.id}>
                {source.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label htmlFor="status">Status</label>
          <select id="status" value={filters.status} onChange={(event) => setFilter("status", event.target.value)}>
            <option value="any">Qualquer status</option>
            <option value="ongoing">Em andamento</option>
            <option value="complete">Completa</option>
            <option value="paused">Pausada</option>
          </select>
        </div>

        <div className="filter-chips" aria-label="Tags">
          {tags.map((tag) => (
            <button className={`chip ${filters.tags.includes(tag) ? "active" : ""}`} key={tag} onClick={() => toggleTag(tag)}>
              {tag}
            </button>
          ))}
        </div>

        <div className="field-grid two">
          <div className="field-group">
            <label htmlFor="language">Idioma</label>
            <select id="language" value={filters.language} onChange={(event) => setFilter("language", event.target.value)}>
              <option value="pt-br">PT-BR</option>
              <option value="en">EN</option>
              <option value="all">Todos</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="max-chapters">Max.</label>
            <input
              id="max-chapters"
              type="number"
              min={1}
              max={9999}
              value={filters.maxChapters}
              onChange={(event) => setFilter("maxChapters", Number(event.target.value))}
            />
          </div>
        </div>

        <label className="toggle-line">
          <input type="checkbox" checked={filters.onlyCovered} onChange={(event) => setFilter("onlyCovered", event.target.checked)} />
          <span className="toggle" />
          <span>Mostrar apenas com capa</span>
        </label>
        <label className="toggle-line">
          <input type="checkbox" checked={filters.updatedOnly} onChange={(event) => setFilter("updatedOnly", event.target.checked)} />
          <span className="toggle" />
          <span>Somente atualizadas</span>
        </label>
      </>
    </aside>
  );
}

function NovelCard({
  novel,
  selected,
  focused,
  onToggle,
  onFocus
}: {
  novel: Novel;
  selected: boolean;
  focused: boolean;
  onToggle: () => void;
  onFocus: () => void;
}) {
  const handleCardClick = () => {
    onFocus();
    onToggle();
  };

  const handleCheckClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    handleCardClick();
  };

  return (
    <article className={`book-card ${selected ? "selected" : ""} ${focused ? "focused" : ""}`} onClick={handleCardClick}>
      <button
        className={`card-check ${selected ? "active" : ""}`}
        aria-label="Selecionar novel"
        onClick={handleCheckClick}
      >
        {selected ? <Check size={11} /> : null}
      </button>
      <div
        className={`book-cover ${novel.coverClass}`}
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
  selectedNovels,
  selections,
  onChange,
  onAdd,
  onReorder
}: {
  selectedNovels: Novel[];
  selections: Record<string, ChapterSelection>;
  onChange: (selection: ChapterSelection) => void;
  onAdd: () => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const overIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!expandedId) return;
    if (!selectedNovels.some((novel) => novel.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, selectedNovels]);

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const card = event.currentTarget.closest("[data-card-id]") as HTMLElement | null;
    const id = card?.getAttribute("data-card-id") ?? null;
    if (!id) return;
    event.preventDefault();
    dragIdRef.current = id;
    overIdRef.current = id;
    setDragId(id);
    setOverId(id);

    const onMove = (moveEvent: PointerEvent) => {
      const cards = listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]");
      if (!cards) return;
      let target = overIdRef.current;
      cards.forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (moveEvent.clientY >= rect.top && moveEvent.clientY <= rect.bottom) {
          target = element.getAttribute("data-card-id");
        }
      });
      if (target !== overIdRef.current) {
        overIdRef.current = target;
        setOverId(target);
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const from = dragIdRef.current;
      const to = overIdRef.current;
      if (from && to && from !== to) {
        const ids = selectedNovels.map((novel) => novel.id);
        const next = ids.filter((value) => value !== from);
        next.splice(next.indexOf(to), 0, from);
        onReorder(next);
      }
      dragIdRef.current = null;
      overIdRef.current = null;
      setDragId(null);
      setOverId(null);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <aside className="selection-drawer">
      <div className="panel-header">
        <div>
          <h2>Capitulos</h2>
          <span>{selectedNovels.length === 0 ? "Selecione livros" : `${selectedNovels.length} livro(s)`}</span>
        </div>
        <button className="button primary compact" disabled={selectedNovels.length === 0} onClick={onAdd}>
          <Download size={15} />
          Adicionar a fila
        </button>
      </div>
      {selectedNovels.length > 1 ? (
        <p className="reorder-hint">
          <GripVertical size={13} />
          Arraste pela alca para priorizar (topo = primeiro)
        </p>
      ) : null}
      <div className="selection-list" ref={listRef}>
        {selectedNovels.length === 0 ? (
          <div className="empty-state compact">
            <BookOpen size={18} />
            <span>Clique em um card para configurar capitulos.</span>
          </div>
        ) : (
          selectedNovels.map((novel, index) => {
            const selection = selections[novel.id] ?? defaultSelection(novel);
            const expanded = expandedId === novel.id;
            const update = (patch: Partial<ChapterSelection>) => onChange({ ...selection, ...patch });
            const toggleFormat = (format: DownloadFormat) => {
              const has = selection.formats.includes(format);
              if (has && selection.formats.length === 1) return;
              const next = has
                ? selection.formats.filter((item) => item !== format)
                : downloadFormats.filter((item) => selection.formats.includes(item) || item === format);
              update({ formats: next });
            };
            return (
              <article
                className={`selection-card ${expanded ? "expanded" : "collapsed"} ${dragId === novel.id ? "dragging" : ""} ${overId === novel.id && dragId && dragId !== novel.id ? "drop-target" : ""}`}
                key={novel.id}
                data-card-id={novel.id}
              >
                <div className="selection-card-head">
                  <span
                    className="drag-handle"
                    title="Arraste para reordenar a prioridade"
                    aria-label="Arraste para reordenar"
                    onPointerDown={startDrag}
                  >
                    <GripVertical size={15} />
                  </span>
                  <span className="priority-badge" title="Prioridade na fila">{index + 1}</span>
                  <button
                    className="selection-summary"
                    aria-expanded={expanded}
                    aria-label={`${expanded ? "Recolher" : "Expandir"} configuracao de ${novel.title}`}
                    onClick={() => setExpandedId((current) => current === novel.id ? null : novel.id)}
                  >
                    <div className="selection-title">
                      <strong>{novel.title}</strong>
                      <small>{novel.chapters.toLocaleString("pt-BR")} capitulos</small>
                    </div>
                    <ChevronDown size={15} className={`selection-chevron ${expanded ? "open" : ""}`} />
                  </button>
                </div>
                {expanded ? (
                  <div className="selection-body">
                    <div className="segmented presets">
                      {([["all", "Todos"], ["range", "Faixa"]] as const).map(([value, label]) => (
                        <button
                          className={selection.preset === value ? "active" : ""}
                          key={value}
                          onClick={() =>
                            update(value === "range" ? { preset: "range", start: 1, end: novel.chapters } : { preset: "all" })
                          }
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {selection.preset === "range" ? (
                      <div className="chapter-range">
                        <label>
                          Inicio
                          <input
                            type="number"
                            min={1}
                            max={selection.end}
                            value={selection.start}
                            onChange={(event) => {
                              const raw = Number(event.target.value) || 1;
                              update({ start: Math.max(1, Math.min(raw, selection.end)) });
                            }}
                          />
                        </label>
                        <label>
                          Fim
                          <input
                            type="number"
                            min={selection.start}
                            max={novel.chapters}
                            value={selection.end}
                            onChange={(event) => {
                              const raw = Number(event.target.value) || selection.start;
                              update({ end: Math.min(novel.chapters, Math.max(raw, selection.start)) });
                            }}
                          />
                        </label>
                      </div>
                    ) : null}
                    <div className="format-group">
                      <span className="field-caption">Formatos</span>
                      <div className="format-options">
                        {downloadFormats.map((format) => (
                          <button
                            key={format}
                            className={`format-chip ${selection.formats.includes(format) ? "active" : ""}`}
                            aria-pressed={selection.formats.includes(format)}
                            onClick={() => toggleFormat(format)}
                          >
                            {format}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="selection-options">
                      <button
                        className={`option-toggle ${selection.translate ? "active" : ""}`}
                        onClick={() => update({ translate: !selection.translate })}
                        aria-pressed={selection.translate}
                      >
                        <Languages size={14} />
                        Traduzir
                      </button>
                      <button
                        className={`option-toggle ${selection.audiobook ? "active" : ""}`}
                        onClick={() => update({ audiobook: !selection.audiobook })}
                        aria-pressed={selection.audiobook}
                      >
                        <Headphones size={14} />
                        Audiobook
                      </button>
                    </div>
                    <p>{selectionLabel(selection, novel.chapters)} - {estimateChapters(selection, novel.chapters).toLocaleString("pt-BR")} capitulos</p>
                  </div>
                ) : null}
              </article>
            );
          })
        )}
      </div>
    </aside>
  );
}

export function DiscoverView({
  sources,
  filters,
  results,
  loading,
  selectedIds,
  focusedNovel,
  filterCollapsed,
  selections,
  onFiltersChange,
  onToggleFilters,
  onToggleNovel,
  onFocusNovel,
  onSelectionChange,
  onAddSelected,
  onReorder
}: {
  sources: SourceSite[];
  filters: Filters;
  results: Novel[];
  loading: boolean;
  selectedIds: string[];
  focusedNovel?: Novel;
  filterCollapsed: boolean;
  selections: Record<string, ChapterSelection>;
  onFiltersChange: (filters: Filters) => void;
  onToggleFilters: () => void;
  onToggleNovel: (novel: Novel) => void;
  onFocusNovel: (novel: Novel) => void;
  onSelectionChange: (selection: ChapterSelection) => void;
  onAddSelected: () => void;
  onReorder: (orderedIds: string[]) => void;
}) {
  const selectedNovels = selectedIds
    .map((id) => results.find((novel) => novel.id === id))
    .filter((novel): novel is Novel => Boolean(novel));

  return (
    <>
      {!filterCollapsed ? (
        <FiltersPanel
          filters={filters}
          sources={sources}
          onChange={onFiltersChange}
        />
      ) : null}
      <section className="content-area">
        <div className="toolbar">
          <div>
            <h2>Resultados</h2>
            <span>{loading ? "Buscando..." : `${results.length} livros encontrados`}</span>
          </div>
          <div className="toolbar-actions">
            <button className="button quiet" onClick={onToggleFilters}>
              <SlidersHorizontal size={16} />
              {filterCollapsed ? "Filtros" : "Ocultar filtros"}
            </button>
          </div>
        </div>

        <div className="active-filter-row">
          {filters.sourceId !== "all" ? <span>{sources.find((source) => source.id === filters.sourceId)?.name}</span> : <span>Todos os sites</span>}
          {filters.tags.map((tag) => <span key={tag}>{tag}</span>)}
          <span>{filters.language.toUpperCase()}</span>
          <button onClick={() => onFiltersChange(defaultFilters())}>Limpar</button>
        </div>

        {loading ? (
          <SkeletonGrid />
        ) : (
          <div className="book-grid compact">
            {results.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                selected={selectedIds.includes(novel.id)}
                focused={focusedNovel?.id === novel.id}
                onToggle={() => onToggleNovel(novel)}
                onFocus={() => onFocusNovel(novel)}
              />
            ))}
          </div>
        )}

      </section>
      {selectedNovels.length > 0 ? (
        <SelectionConfigurator
          selectedNovels={selectedNovels}
          selections={selections}
          onChange={onSelectionChange}
          onAdd={onAddSelected}
          onReorder={onReorder}
        />
      ) : null}
    </>
  );
}
