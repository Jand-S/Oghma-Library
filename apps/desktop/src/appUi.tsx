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
import { defaultAppConfig } from "./appConfig";
import { downloadFormats } from "./types";
import { defaultFilters, defaultSelection, estimateChapters, selectionLabel } from "./mockBackend";
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
} from "./types";
import { runWindowAction } from "./windowControls";

const tags = ["Fantasia", "Romance", "Misterio", "Isekai", "Aventura", "Drama"];

const views: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "discover", label: "Buscar", icon: Home },
  { id: "sources", label: "Fontes", icon: Globe2 },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "settings", label: "Ajustes", icon: Settings }
];

const statusLabel = {
  ongoing: "Em andamento",
  complete: "Completa",
  paused: "Pausada"
};

export const pageTitle: Record<ViewId, string> = {
  discover: "Download Search",
  sources: "Selecao de sites",
  downloads: "Fila de downloads",
  library: "Biblioteca local",
  settings: "Ajustes"
};

export const onboardingSteps = ["Bem-vindo", "Servidor", "Saida", "Fontes", "Preferencias", "Resumo", "Sincronizacao"];

const indexModeOptions: Array<{ value: IndexMode; label: string; description: string }> = [
  { value: "incremental_recent", label: "Incremental", description: "Atualiza novidades e preserva o catalogo sem recrawlar tudo." },
  { value: "catalog_only", label: "Somente catalogo", description: "Baixa apenas metadados e index de capitulos." },
  { value: "guarded_refresh", label: "Varredura protegida", description: "Revalida fontes com mais cuidado e menor ritmo." }
];

const translationEngineOptions: Array<{ value: TranslationEngine; label: string }> = [
  { value: "local", label: "Modelo local" },
  { value: "openai", label: "OpenAI" },
  { value: "deepl", label: "DeepL" },
  { value: "google", label: "Google Translate" }
];

export type SetupSyncEntry = {
  progress: number;
  status: "pending" | "syncing" | "done" | "error";
  detail: string;
};

export function SplashScreen({ done }: { done: boolean }) {
  const [step, setStep] = useState(0);
  const labels = ["Inicializando UI", "Conectando backend mock", "Carregando catalogo", "Preparando fila"];

  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, labels.length - 1)), 380);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`splash-screen ${done ? "leaving" : ""}`}>
      <div className="splash-card">
        <img src="/icons/oghma-loop.svg" alt="Oghma Library" />
        <h1>Oghma Library</h1>
        <p>{labels[step]}</p>
        <div className="splash-progress">
          <span style={{ width: `${(step + 1) * 25}%` }} />
        </div>
      </div>
    </div>
  );
}

export function Titlebar({ title }: { title: string }) {
  const stopDrag = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span data-tauri-drag-region>{title}</span>
      </div>
      <div className="window-controls" aria-label="Controles da janela">
        <button onMouseDown={stopDrag} onClick={() => void runWindowAction("minimize")} aria-label="Minimizar">
          <Minus size={13} />
        </button>
        <button onMouseDown={stopDrag} onClick={() => void runWindowAction("maximize")} aria-label="Maximizar">
          <Square size={11} />
        </button>
        <button className="close" onMouseDown={stopDrag} onClick={() => void runWindowAction("close")} aria-label="Fechar">
          <X size={13} />
        </button>
      </div>
    </header>
  );
}

export function Sidebar({
  activeView,
  expanded,
  flashKey = 0,
  onToggle,
  onChange
}: {
  activeView: ViewId;
  expanded: boolean;
  flashKey?: number;
  onToggle: () => void;
  onChange: (view: ViewId) => void;
}) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 700);
    return () => window.clearTimeout(timer);
  }, [flashKey]);
  return (
    <aside className={`app-sidebar ${expanded ? "expanded" : ""}`}>
      <button className="brand-mark" onClick={onToggle} aria-label="Alternar menu lateral">
        <img src="/icons/oghma-icon.svg" alt="" />
        <span>Oghma</span>
      </button>
      <nav className="nav-stack" aria-label="Principal">
        {views.map((view) => {
          const Icon = view.icon;
          return (
            <button
              className={`nav-button ${activeView === view.id ? "active" : ""} ${flashing && view.id === "downloads" ? "flash" : ""}`}
              key={view.id}
              title={view.label}
              onClick={() => onChange(view.id)}
            >
              <Icon size={18} />
              <span>{view.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="nav-button bottom-toggle" onClick={onToggle} title="Expandir menu">
        {expanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        <span>Retrair</span>
      </button>
    </aside>
  );
}

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

export function SourcesView({
  sources,
  syncing,
  onToggle,
  onSync
}: {
  sources: SourceSite[];
  syncing: string[];
  onToggle: (id: string) => void;
  onSync: (id: string) => void;
}) {
  return (
    <section className="page-area full-span">
      <div className="source-grid">
        {sources.map((source) => (
          <article className="source-card" key={source.id}>
            <div className="source-card-top">
              <span className={`status-dot ${syncing.includes(source.id) ? "syncing" : source.status}`} />
              <strong>{source.name}</strong>
              {syncing.includes(source.id) ? <Loader2 className="spin" size={16} /> : null}
            </div>
            <p>{source.baseUrl}</p>
            <div className="source-meta">
              <span>{source.mode}</span>
              <span>{source.count.toLocaleString("pt-BR")} novels</span>
              <span>{source.lastSync}</span>
            </div>
            <div className="source-actions">
              <button className={`button ${source.enabled ? "primary" : "quiet"}`} onClick={() => onToggle(source.id)}>
                {source.enabled ? "Ativo" : "Inativo"}
              </button>
              <button className="button quiet" onClick={() => onSync(source.id)} disabled={syncing.includes(source.id)}>
                <RefreshCcw size={15} />
                Sincronizar
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function DownloadsView({
  queue,
  paused,
  selectedIds,
  kindleConnected,
  kindleDisabledReason,
  onPauseToggle,
  onToggleSelect,
  onToggleSelectAll,
  onExportSelected,
  onClearSelected,
  onCancel,
  onOpenFolder,
  onOpenItemFolder,
  onSendToKindle
}: {
  queue: QueueItem[];
  paused: boolean;
  selectedIds: string[];
  kindleConnected: boolean;
  kindleDisabledReason?: string;
  onPauseToggle: () => void;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onExportSelected: () => void;
  onClearSelected: () => void;
  onCancel: (id: string) => void;
  onOpenFolder: () => void;
  onOpenItemFolder: (item: QueueItem) => void;
  onSendToKindle: () => void;
}) {
  const pending = queue.filter((item) => item.state !== "done");
  const completed = queue.filter((item) => item.state === "done");
  const allSelected = completed.length > 0 && completed.every((item) => selectedIds.includes(item.id));
  const selectedCount = completed.filter((item) => selectedIds.includes(item.id)).length;

  return (
    <section className="page-area full-span">
      <div className="downloads-split">
        <section className="downloads-pane">
          <div className="pane-header">
            <div>
              <h3>Em andamento</h3>
              <span>{pending.length} item(ns)</span>
            </div>
            <button className="button quiet compact" onClick={onPauseToggle} disabled={pending.length === 0}>
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? "Retomar" : "Pausar"}
            </button>
          </div>
          <div className="download-table">
            {pending.length === 0 ? (
              <div className="empty-state compact">Nenhum download pendente.</div>
            ) : (
              pending.map((item) => {
                const downloading = item.state === "downloading";
                const failed = item.state === "error";
                const currentChapter = Math.min(item.chaptersTotal, Math.round((item.progress / 100) * item.chaptersTotal));
                const remaining = Math.max(0, item.chaptersTotal - currentChapter);
                const etaSeconds = Math.round(remaining * 0.6);
                const eta = `${Math.floor(etaSeconds / 60)}:${String(etaSeconds % 60).padStart(2, "0")}`;
                const speed = `${(1.4 + (item.progress % 12) * 0.05).toFixed(1)} MB/s`;
                return (
                  <article className={`download-row pending ${item.state}`} key={item.id}>
                    <div
                      className={`queue-thumb ${item.coverClass}`}
                      style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    />
                    <div className="download-info">
                      <strong>{item.title}</strong>
                      <small>{item.rangeLabel}</small>
                      <div className="progress"><span style={{ width: `${item.progress}%` }} /></div>
                      <span className="download-meta">
                        {failed
                          ? item.error ?? "Falha no download"
                          : downloading
                          ? `Cap. ${currentChapter}/${item.chaptersTotal.toLocaleString("pt-BR")} - ${speed} - ETA ${eta}`
                          : `${item.state} - ${Math.round(item.progress)}%`}
                      </span>
                    </div>
                    <button className="cancel-chip" onClick={() => onCancel(item.id)}>Cancelar</button>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="downloads-pane">
          <div className="pane-header">
            <div>
              <h3>Concluidos</h3>
              <span>{selectedCount > 0 ? `${selectedCount} selecionado(s)` : `${completed.length} item(ns)`}</span>
            </div>
            <div className="pane-actions">
              <button className="icon-button small" title={allSelected ? "Limpar selecao" : "Selecionar todos"} aria-label="Selecionar todos" onClick={onToggleSelectAll} disabled={completed.length === 0}>
                {allSelected ? <CheckSquare size={15} /> : <Square size={15} />}
              </button>
              {kindleConnected ? (
                <button
                  className="button primary compact"
                  title={kindleDisabledReason ?? "Converter para AZW3 e enviar ao Kindle"}
                  aria-label="Enviar ao Kindle"
                  onClick={onSendToKindle}
                  disabled={Boolean(kindleDisabledReason)}
                >
                  <BookOpen size={15} />
                  Enviar ao Kindle
                </button>
              ) : null}
              <button className="button quiet compact" title="Abrir pasta local" aria-label="Abrir pasta local" onClick={onOpenFolder}>
                <FolderOpen size={15} />
                Abrir pasta
              </button>
              <button className="button quiet compact" onClick={onClearSelected} disabled={selectedCount === 0}>
                <Trash2 size={15} />
                Limpar
              </button>
              <button className="button primary compact" onClick={onExportSelected} disabled={selectedCount === 0}>
                <Library size={15} />
                Exportar
              </button>
            </div>
          </div>
          {kindleConnected && kindleDisabledReason && selectedCount > 0 ? <p className="action-hint">{kindleDisabledReason}</p> : null}
          <div className="download-table">
            {completed.length === 0 ? (
              <div className="empty-state compact">Nenhum download concluido.</div>
            ) : (
              completed.map((item) => {
                const selected = selectedIds.includes(item.id);
                return (
                  <article
                    className={`download-row complete ${selected ? "selected" : ""}`}
                    key={item.id}
                    role="button"
                    aria-pressed={selected}
                    onClick={() => onToggleSelect(item.id)}
                  >
                    <span className={`row-check ${selected ? "active" : ""}`} aria-hidden="true">
                      {selected ? <Check size={11} /> : null}
                    </span>
                    <div
                      className={`queue-thumb ${item.coverClass}`}
                      style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    />
                    <div className="download-info">
                      <strong>{item.title}</strong>
                      <small>{item.rangeLabel}</small>
                      {item.outputFiles && item.outputFiles.length > 0 ? (
                        <small>{item.outputFiles.join(", ")}</small>
                      ) : null}
                      <div className="queue-badges">
                        {item.formats.map((format) => (
                          <span className="badge" key={format}>{format}</span>
                        ))}
                        {item.translate ? <span className="badge accent"><Languages size={11} /> Traduzir</span> : null}
                        {item.audiobook ? <span className="badge accent"><Headphones size={11} /> Audiobook</span> : null}
                      </div>
                    </div>
                    <button
                      className="icon-button small row-folder"
                      title="Abrir pasta deste livro"
                      aria-label={`Abrir pasta de ${item.title}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenItemFolder(item);
                      }}
                    >
                      <FolderOpen size={15} />
                    </button>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

export function KindleTransferModal({
  open,
  items,
  progress,
  sending,
  completed,
  onClose,
  onStart
}: {
  open: boolean;
  items: QueueItem[];
  progress: number;
  sending: boolean;
  completed: boolean;
  onClose: () => void;
  onStart: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="kindle-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="kindle-modal-title">Enviar ao Kindle</h2>
            <span>{items.length} livro(s) selecionado(s)</span>
          </div>
          <button className="icon-button small" aria-label="Fechar modal" onClick={onClose} disabled={sending}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <p>Os livros selecionados serao convertidos de EPUB para AZW3 antes do envio direto ao Kindle conectado.</p>
          <div className="modal-list">
            {items.map((item) => (
              <span className="badge" key={item.id}>{item.title}</span>
            ))}
          </div>
          <div className="kindle-progress-block">
            <div className="kindle-progress-header">
              <strong>{completed ? "Conversao concluida" : sending ? "Convertendo para AZW3" : "Pronto para converter"}</strong>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="progress"><span style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="button quiet" onClick={onClose} disabled={sending}>
            {completed ? "Fechar" : "Cancelar"}
          </button>
          <button className="button primary" onClick={onStart} disabled={sending || completed}>
            {sending ? "Convertendo..." : completed ? "Enviado" : "Converter e enviar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingWizard({
  open,
  allowClose,
  step,
  config,
  sources,
  serverProbe,
  probingServer,
  setupSync,
  setupSyncRunning,
  setupSyncCompleted,
  onChange,
  onToggleSource,
  onValidateServer,
  onBack,
  onNext,
  onClose
}: {
  open: boolean;
  allowClose: boolean;
  step: number;
  config: AppConfig;
  sources: SourceSite[];
  serverProbe: ServerProbe | null;
  probingServer: boolean;
  setupSync: Record<string, SetupSyncEntry>;
  setupSyncRunning: boolean;
  setupSyncCompleted: boolean;
  onChange: (patch: Partial<AppConfig>) => void;
  onToggleSource: (sourceId: string) => void;
  onValidateServer: () => void;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const selectedSources = sources.filter((source) => config.enabledSourceIds.includes(source.id));
  const isLastStep = step === onboardingSteps.length - 1;
  const summaryStep = onboardingSteps.length - 2;
  const overallProgress = selectedSources.length === 0
    ? 0
    : Math.round(selectedSources.reduce((total, source) => total + (setupSync[source.id]?.progress ?? 0), 0) / selectedSources.length);
  const canProceed = (() => {
    if (step === 1) return Boolean(serverProbe && serverProbe.serverUrl === config.serverUrl);
    if (step === 2) return config.outputPath.trim().length > 0;
    if (step === 3) return selectedSources.length > 0;
    if (step === onboardingSteps.length - 1) return setupSyncCompleted;
    return true;
  })();

  return (
    <div className="setup-backdrop">
      <section className="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="setup-header">
          <div>
            <span className="setup-eyebrow">Configuracao inicial</span>
            <h1 id="setup-title">{onboardingSteps[step]}</h1>
          </div>
          {allowClose ? (
            <button className="icon-button small" aria-label="Fechar assistente" onClick={onClose}>
              <X size={15} />
            </button>
          ) : null}
        </div>

        <div className="setup-stepper" aria-label="Etapas da configuracao">
          {onboardingSteps.map((label, index) => (
            <div className={`setup-step ${index === step ? "active" : ""} ${index < step ? "done" : ""}`} key={label}>
              <span>{index < step ? <Check size={12} /> : index + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>

        {step === 0 ? (
          <div className="setup-content">
            <div className="setup-hero">
              <div>
                <h2>Bem-vindo ao Oghma Library</h2>
                <p>Vamos preparar o ambiente inicial para indexar fontes, definir a pasta de saida e deixar o fluxo pronto para downloads, EPUB e etapas futuras como traducao e audiobook.</p>
              </div>
              <div className="setup-grid three">
                <article className="setup-info-card">
                  <strong>Servidor de index</strong>
                  <p>Conecta ao node que mantem catalogo, fontes suportadas e estado de sincronizacao.</p>
                </article>
                <article className="setup-info-card">
                  <strong>Saida local</strong>
                  <p>Escolhe a pasta onde os livros exportados, caches e conversoes vao morar.</p>
                </article>
                <article className="setup-info-card">
                  <strong>Preferencias padrao</strong>
                  <p>Define formatos, motor de IA e comportamento de sincronizacao para o primeiro uso.</p>
                </article>
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Servidor e modo de indexacao</h2>
              <p>Este servidor entrega o catalogo inicial e a lista de fontes disponiveis para preservacao.</p>
            </div>
            <div className="field-group">
              <label htmlFor="setup-server-url">Servidor de index</label>
              <input
                id="setup-server-url"
                value={config.serverUrl}
                onChange={(event) => onChange({ serverUrl: event.target.value })}
                placeholder="http://192.168.0.42:8000"
              />
            </div>
            <div className="field-group">
              <label>Modo de indexacao</label>
              <div className="setup-choice-grid">
                {indexModeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`setup-choice ${config.indexMode === option.value ? "active" : ""}`}
                    aria-pressed={config.indexMode === option.value}
                    onClick={() => onChange({ indexMode: option.value })}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-inline-actions">
              <button className="button primary" onClick={onValidateServer} disabled={probingServer || config.serverUrl.trim().length === 0}>
                {probingServer ? <Loader2 className="spin" size={15} /> : <Globe2 size={15} />}
                {probingServer ? "Validando..." : "Verificar servidor"}
              </button>
            </div>
            {serverProbe && serverProbe.serverUrl === config.serverUrl ? (
              <div className="setup-status-card">
                <div className="setup-status-title">
                  <CheckCircle2 size={16} />
                  <strong>{serverProbe.serverName}</strong>
                </div>
                <div className="setup-grid three">
                  <div><span>Versao</span><strong>{serverProbe.version}</strong></div>
                  <div><span>Latencia</span><strong>{serverProbe.latencyMs} ms</strong></div>
                  <div><span>Fontes</span><strong>{serverProbe.sourceCount} disponiveis</strong></div>
                </div>
                <small>Storage informado pelo servidor: {serverProbe.storageRoot}</small>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Pasta de saida</h2>
              <p>Use uma pasta previsivel para EPUBs, PDFs, conversoes para Kindle e artefatos auxiliares.</p>
            </div>
            <div className="field-group">
              <label htmlFor="setup-output">Pasta local de saida</label>
              <input
                id="setup-output"
                value={config.outputPath}
                onChange={(event) => onChange({ outputPath: event.target.value })}
                placeholder="~/Documents/Oghma Library/exports"
              />
            </div>
            <div className="setup-inline-actions">
              <button className="button quiet" onClick={() => onChange({ outputPath: defaultAppConfig().outputPath })}>
                <FolderOpen size={15} />
                Usar pasta padrao
              </button>
            </div>
            <div className="setup-info-strip">
              <strong>Padrao sugerido</strong>
              <span>{defaultAppConfig().outputPath}</span>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Selecione as fontes para indexar</h2>
              <p>A lista abaixo foi entregue pelo servidor configurado. Voce pode ativar so o que realmente quer preservar agora.</p>
            </div>
            <div className="setup-source-grid">
              {sources.map((source) => {
                const active = config.enabledSourceIds.includes(source.id);
                return (
                  <button
                    key={source.id}
                    className={`setup-source-card ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onToggleSource(source.id)}
                  >
                    <div className="setup-source-head">
                      <span className={`status-dot ${source.status}`} />
                      <strong>{source.name}</strong>
                    </div>
                    <p>{source.baseUrl}</p>
                    <div className="setup-source-meta">
                      <span>{source.mode}</span>
                      <span>{source.count.toLocaleString("pt-BR")} novels</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Preferencias iniciais</h2>
              <p>Esses valores entram como padrao nos downloads e servem como base para as features futuras do backend.</p>
            </div>
            <div className="field-group">
              <label>Formatos padrao</label>
              <div className="format-options">
                {downloadFormats.map((item) => (
                  <button
                    key={item}
                    className={`format-chip ${config.defaultFormats.includes(item) ? "active" : ""}`}
                    aria-pressed={config.defaultFormats.includes(item)}
                    onClick={() => {
                      const has = config.defaultFormats.includes(item);
                      if (has && config.defaultFormats.length === 1) return;
                      onChange({
                        defaultFormats: has
                          ? config.defaultFormats.filter((format) => format !== item)
                          : downloadFormats.filter((format) => config.defaultFormats.includes(format) || format === item)
                      });
                    }}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>
            <div className="field-grid two">
              <div className="field-group">
                <label htmlFor="setup-translation-engine">Motor de IA padrao</label>
                <select
                  id="setup-translation-engine"
                  value={config.translationEngine}
                  onChange={(event) => onChange({ translationEngine: event.target.value as TranslationEngine })}
                >
                  {translationEngineOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="setup-language">Idioma de destino</label>
                <select id="setup-language" value={config.targetLanguage} onChange={(event) => onChange({ targetLanguage: event.target.value })}>
                  <option value="PT-BR">Portugues (BR)</option>
                  <option value="EN">Ingles</option>
                  <option value="ES">Espanhol</option>
                </select>
              </div>
            </div>
            <label className="toggle-line">
              <input type="checkbox" checked={config.translateDefault} onChange={(event) => onChange({ translateDefault: event.target.checked })} />
              <span className="toggle" />
              <span>Traduzir por padrao</span>
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={config.audiobookDefault} onChange={(event) => onChange({ audiobookDefault: event.target.checked })} />
              <span className="toggle" />
              <span>Gerar audiobook por padrao</span>
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={config.syncOnLaunch} onChange={(event) => onChange({ syncOnLaunch: event.target.checked })} />
              <span className="toggle" />
              <span>Sincronizar indices ao abrir o app</span>
            </label>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Resumo da configuracao</h2>
              <p>Se estiver tudo certo, seguimos para a sincronizacao inicial dos indices das fontes selecionadas.</p>
            </div>
            <div className="setup-summary">
              <div><span>Servidor</span><strong>{config.serverUrl}</strong></div>
              <div><span>Modo de indexacao</span><strong>{indexModeOptions.find((option) => option.value === config.indexMode)?.label}</strong></div>
              <div><span>Pasta de saida</span><strong>{config.outputPath}</strong></div>
              <div><span>Fontes ativas</span><strong>{selectedSources.map((source) => source.name).join(", ")}</strong></div>
              <div><span>Formatos padrao</span><strong>{config.defaultFormats.join(", ")}</strong></div>
              <div><span>Motor de IA</span><strong>{translationEngineOptions.find((option) => option.value === config.translationEngine)?.label}</strong></div>
            </div>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Sincronizacao inicial dos indices</h2>
              <p>Agora o app esta baixando os indices e metadados basicos das fontes selecionadas para deixar a busca pronta no primeiro uso.</p>
            </div>
            <div className="setup-status-card">
              <div className="setup-status-title">
                <strong>{setupSyncCompleted ? "Sincronizacao concluida" : setupSyncRunning ? "Baixando indices das fontes" : "Preparando sincronizacao"}</strong>
                <span>{overallProgress}%</span>
              </div>
              <div className="progress"><span style={{ width: `${overallProgress}%` }} /></div>
            </div>
            <div className="setup-sync-list">
              {selectedSources.map((source) => {
                const state = setupSync[source.id] ?? { progress: 0, status: "pending", detail: "Aguardando..." };
                const statusLabelText = state.status === "done"
                  ? "Pronto"
                  : state.status === "syncing"
                    ? "Baixando"
                    : state.status === "error"
                      ? "Falhou"
                      : "Aguardando";
                return (
                  <article className="setup-sync-row" key={source.id}>
                    <div className="setup-sync-meta">
                      <div>
                        <strong>{source.name}</strong>
                        <small>{state.detail}</small>
                      </div>
                      <span className={`setup-sync-badge ${state.status}`}>{statusLabelText}</span>
                    </div>
                    <div className="progress thin"><span style={{ width: `${state.progress}%` }} /></div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="setup-footer">
          <button className="button quiet" onClick={onBack} disabled={step === 0 || setupSyncRunning}>
            Voltar
          </button>
          <button className="button primary" onClick={onNext} disabled={!canProceed}>
            {isLastStep ? "Entrar no app" : step === summaryStep ? "Concluir e baixar indices" : "Proximo"}
          </button>
        </div>
      </section>
    </div>
  );
}

export function LibraryView({ library }: { library: LibraryItem[] }) {
  return (
    <section className="page-area full-span">
      <div className="page-header">
        <button className="button quiet">
          <FolderOpen size={16} />
          Abrir pasta
        </button>
      </div>
      <div className="library-grid">
        {library.map((item) => (
          <article className="library-card" key={item.id}>
            <div className={`book-cover ${item.coverClass}`} />
            <div>
              <strong>{item.title}</strong>
              <small>{item.author}</small>
              <p>{item.format} - {item.chapters} capitulos - {item.sizeMb} MB</p>
            </div>
            <button className="icon-button small" title="Exportar">
              <ExternalLink size={15} />
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}

export function SettingsView({
  config,
  onConfigChange,
  onOpenOnboarding
}: {
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onOpenOnboarding: () => void;
}) {
  return (
    <section className="page-area full-span">
      <div className="page-header">
        <button className="button quiet" onClick={onOpenOnboarding}>
          <Settings size={15} />
          Assistente inicial
        </button>
      </div>
      <div className="settings-grid">
        <article className="settings-panel">
          <h3>Servidor</h3>
          <div className="field-group">
            <label>API local</label>
            <input value={config.serverUrl} onChange={(event) => onConfigChange({ serverUrl: event.target.value })} />
          </div>
          <div className="field-group">
            <label>Pasta de saida</label>
            <input value={config.outputPath} onChange={(event) => onConfigChange({ outputPath: event.target.value })} />
          </div>
          <div className="field-group">
            <label htmlFor="settings-index-mode">Modo de indexacao</label>
            <select id="settings-index-mode" value={config.indexMode} onChange={(event) => onConfigChange({ indexMode: event.target.value as IndexMode })}>
              {indexModeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </article>

        <article className="settings-panel">
          <h3>Download</h3>
          <div className="field-group">
            <label>Formatos padrao</label>
            <div className="format-options">
              {downloadFormats.map((item) => (
                <button
                  key={item}
                  className={`format-chip ${config.defaultFormats.includes(item) ? "active" : ""}`}
                  aria-pressed={config.defaultFormats.includes(item)}
                  onClick={() => {
                    const has = config.defaultFormats.includes(item);
                    if (has && config.defaultFormats.length === 1) return;
                    onConfigChange({
                      defaultFormats: has
                        ? config.defaultFormats.filter((format) => format !== item)
                        : downloadFormats.filter((format) => config.defaultFormats.includes(format) || format === item)
                    });
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <label className="toggle-line">
            <input type="checkbox" checked={config.translateDefault} onChange={(event) => onConfigChange({ translateDefault: event.target.checked })} />
            <span className="toggle" />
            <span>Traduzir por padrao</span>
          </label>
          <label className="toggle-line">
            <input type="checkbox" checked={config.audiobookDefault} onChange={(event) => onConfigChange({ audiobookDefault: event.target.checked })} />
            <span className="toggle" />
            <span>Gerar audiobook por padrao</span>
          </label>
          <label className="toggle-line">
            <input type="checkbox" checked={config.syncOnLaunch} onChange={(event) => onConfigChange({ syncOnLaunch: event.target.checked })} />
            <span className="toggle" />
            <span>Sincronizar indices ao abrir</span>
          </label>
        </article>

        <article className="settings-panel">
          <h3>Traducao por IA</h3>
          <div className="field-group">
            <label htmlFor="target-language">Idioma de destino</label>
            <select id="target-language" value={config.targetLanguage} onChange={(event) => onConfigChange({ targetLanguage: event.target.value })}>
              <option value="PT-BR">Portugues (BR)</option>
              <option value="EN">Ingles</option>
              <option value="ES">Espanhol</option>
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="translation-engine">Motor de traducao</label>
            <select id="translation-engine" value={config.translationEngine} onChange={(event) => onConfigChange({ translationEngine: event.target.value as TranslationEngine })}>
              {translationEngineOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="translation-key">Chave de API</label>
            <input id="translation-key" type="password" placeholder="chave do servico de traducao" />
          </div>
        </article>

        <article className="settings-panel">
          <h3>Audiobook (TTS)</h3>
          <div className="field-group">
            <label htmlFor="tts-voice">Voz</label>
            <select id="tts-voice" value={config.ttsVoice} onChange={(event) => onConfigChange({ ttsVoice: event.target.value })}>
              <option value="pt-BR-Antonio">pt-BR - Antonio</option>
              <option value="pt-BR-Francisca">pt-BR - Francisca</option>
              <option value="en-US-Guy">en-US - Guy</option>
            </select>
          </div>
          <div className="field-grid two">
            <div className="field-group">
              <label htmlFor="tts-speed">Velocidade ({config.ttsSpeed.toFixed(1)}x)</label>
              <input id="tts-speed" type="range" min={0.5} max={2} step={0.1} value={config.ttsSpeed} onChange={(event) => onConfigChange({ ttsSpeed: Number(event.target.value) })} />
            </div>
            <div className="field-group">
              <label htmlFor="audio-format">Formato de audio</label>
              <select id="audio-format" value={config.audioFormat} onChange={(event) => onConfigChange({ audioFormat: event.target.value })}>
                <option value="M4B">M4B</option>
                <option value="MP3">MP3</option>
                <option value="OGG">OGG</option>
              </select>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
