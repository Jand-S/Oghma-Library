import {
  BookOpen,
  Check,
  ChevronDown,
  Download,
  GripVertical,
  Headphones,
  Languages,
  Search,
  SlidersHorizontal,
  Trash2
} from "lucide-react";
import {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { statusLabel, tags } from "../constants/ui";
import {
  defaultFilters,
  defaultSelection,
  estimateChapters,
  selectionLabel
} from "../core/defaults";
import type {
  ChapterSelection,
  DownloadFormat,
  Filters,
  Novel,
  SourceSite
} from "../core/types";
import { downloadFormats } from "../core/types";

type DiscoverSidebarTab = "queue" | "details";

function FiltersPanel({
  filters,
  sources,
  onChange,
  onBackgroundClick
}: {
  filters: Filters;
  sources: SourceSite[];
  onChange: (filters: Filters) => void;
  onBackgroundClick: (event: MouseEvent<HTMLElement>) => void;
}) {
  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => onChange({ ...filters, [key]: value });
  const toggleTag = (tag: string) => {
    setFilter("tags", filters.tags.includes(tag) ? filters.tags.filter((item) => item !== tag) : [...filters.tags, tag]);
  };
  const changeSource = (sourceId: string) => onChange({ ...filters, sourceId, language: "all" });

  return (
    <aside className="filter-panel" onClick={onBackgroundClick}>
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
          <select id="source" value={filters.sourceId} onChange={(event) => changeSource(event.target.value)} required>
            {sources.filter((source) => source.enabled).map((source) => (
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
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      <button
        className={`card-check ${selected ? "active" : ""}`}
        aria-label={selected ? `Remover ${novel.title} da fila` : `Selecionar ${novel.title} para a fila`}
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
  onReorder,
  onRemove,
  trashRef,
  onDragStateChange
}: {
  selectedNovels: Novel[];
  selections: Record<string, ChapterSelection>;
  onChange: (selection: ChapterSelection) => void;
  onAdd: () => void;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (novelId: string) => void;
  trashRef: RefObject<HTMLElement | null>;
  onDragStateChange: (active: boolean, overTrash: boolean) => void;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
  } | null>(null);
  const [dropY, setDropY] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [addingToQueue, setAddingToQueue] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const dragIdRef = useRef<string | null>(null);
  const orderRef = useRef<string[]>([]);
  const positionsRef = useRef(new Map<string, DOMRect>());
  const addAnimationTimerRef = useRef<number | null>(null);
  const addAnimationTokenRef = useRef(0);

  useLayoutEffect(() => {
    const cards = listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]");
    if (!cards) return;
    const next = new Map<string, DOMRect>();
    cards.forEach((card) => {
      const id = card.dataset.cardId;
      if (!id) return;
      const rect = card.getBoundingClientRect();
      next.set(id, rect);
      const previous = positionsRef.current.get(id);
      const delta = previous ? previous.top - rect.top : 0;
      if (delta && typeof card.animate === "function") {
        card.animate(
          [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
          { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" }
        );
      }
    });
    positionsRef.current = next;
  }, [selectedNovels]);

  useEffect(() => {
    if (!expandedId) return;
    if (!selectedNovels.some((novel) => novel.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, selectedNovels]);

  useEffect(() => () => {
    if (addAnimationTimerRef.current != null) {
      window.clearTimeout(addAnimationTimerRef.current);
    }
  }, []);

  const computeDropIndex = (clientY: number): number => {
    const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-card-id]") ?? []);
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  };

  const lineYForIndex = (index: number): number | null => {
    const list = listRef.current;
    if (!list) return null;
    const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-card-id]"));
    if (cards.length === 0) return null;
    const listTop = list.getBoundingClientRect().top;
    if (index >= cards.length) {
      const last = cards[cards.length - 1].getBoundingClientRect();
      return last.bottom - listTop + list.scrollTop;
    }
    const rect = cards[index].getBoundingClientRect();
    return rect.top - listTop + list.scrollTop;
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>) => {
    const card = event.currentTarget.closest("[data-card-id]") as HTMLElement | null;
    const id = card?.getAttribute("data-card-id") ?? null;
    if (!id || !card) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    try { card.setPointerCapture(pointerId); } catch { /* sem captura: segue com listeners no window */ }
    const rect = card.getBoundingClientRect();
    dragIdRef.current = id;
    orderRef.current = selectedNovels.map((novel) => novel.id);
    setDragId(id);
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width
    });
    onDragStateChange(true, false);

    let lastX = event.clientX;
    let lastY = event.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      setDragPreview((current) => current ? { ...current, x: lastX, y: lastY } : current);
      const trashRect = trashRef.current?.getBoundingClientRect();
      const overTrash = Boolean(trashRect
        && lastX >= trashRect.left
        && lastX <= trashRect.right
        && lastY >= trashRect.top
        && lastY <= trashRect.bottom);
      onDragStateChange(true, overTrash);
      // NUNCA reordena a lista durante o arraste (isso causava o loop que somia tudo).
      // So mostra uma linha indicando onde vai cair; a reordenacao acontece no drop.
      setDropY(overTrash ? null : lineYForIndex(computeDropIndex(lastY)));
    };

    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      try { card.releasePointerCapture(pointerId); } catch { /* ignore */ }
      dragIdRef.current = null;
      setDragId(null);
      setDragPreview(null);
      setDropY(null);
      onDragStateChange(false, false);
    };

    function onUp(upEvent: PointerEvent) {
      const from = dragIdRef.current;
      const trashRect = trashRef.current?.getBoundingClientRect();
      const droppedInTrash = Boolean(trashRect
        && upEvent.clientX >= trashRect.left
        && upEvent.clientX <= trashRect.right
        && upEvent.clientY >= trashRect.top
        && upEvent.clientY <= trashRect.bottom);
      let reordered: string[] | null = null;
      if (from && !droppedInTrash) {
        const order = selectedNovels.map((novel) => novel.id);
        const fromIndex = order.indexOf(from);
        let target = computeDropIndex(upEvent.clientY);
        if (fromIndex !== -1 && fromIndex < target) target -= 1;
        const without = order.filter((id) => id !== from);
        target = Math.max(0, Math.min(without.length, target));
        const next = [...without];
        next.splice(target, 0, from);
        if (next.some((value, index) => value !== order[index])) reordered = next;
      }
      finish();
      if (from && droppedInTrash) onRemove(from);
      else if (reordered) onReorder(reordered);
    }

    function onCancel() {
      finish();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const handleAdd = () => {
    if (addingToQueue || selectedNovels.length === 0) return;
    const list = listRef.current;
    const target = document.querySelector<HTMLElement>('[data-nav="downloads"] .nav-ico')
      ?? document.querySelector<HTMLElement>('[data-nav="downloads"]');
    if (!list || !target) {
      onAdd();
      return;
    }
    setAddingToQueue(true);
    const animationToken = addAnimationTokenRef.current + 1;
    addAnimationTokenRef.current = animationToken;
    const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-card-id]"));
    const targetRect = target.getBoundingClientRect();
    const targetX = targetRect.left + targetRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2;
    cards.forEach((card, index) => {
      const cardRect = card.getBoundingClientRect();
      const clone = card.cloneNode(true) as HTMLElement;
      clone.classList.remove("expanded", "dragging");
      clone.classList.add("collapsed", "selection-card-fly");
      clone.querySelector(".selection-body")?.remove();
      Object.assign(clone.style, {
        position: "fixed",
        left: `${cardRect.left}px`,
        top: `${cardRect.top}px`,
        width: `${cardRect.width}px`,
        height: "auto",
        margin: "0",
        zIndex: "1200",
        pointerEvents: "none",
        transformOrigin: "center center"
      });
      document.body.appendChild(clone);
      const cloneRect = clone.getBoundingClientRect();
      const dx = targetX - (cloneRect.left + cloneRect.width / 2);
      const dy = targetY - (cloneRect.top + cloneRect.height / 2);
      if (typeof clone.animate === "function") {
        const animation = clone.animate(
          [
            { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
            { transform: `translate(${dx * 0.55}px, ${dy * 0.55}px) scale(0.5)`, opacity: 0.95, offset: 0.65 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.1)`, opacity: 0 }
          ],
          { duration: 620, delay: index * 110, easing: "cubic-bezier(.45,.05,.55,.95)", fill: "forwards" }
        );
        animation.onfinish = () => clone.remove();
        animation.oncancel = () => clone.remove();
      } else {
        window.setTimeout(() => clone.remove(), 620 + index * 110);
      }
    });
    const totalDuration = 620 + Math.max(0, cards.length - 1) * 110 + 40;
    if (addAnimationTimerRef.current != null) {
      window.clearTimeout(addAnimationTimerRef.current);
    }
    addAnimationTimerRef.current = window.setTimeout(() => {
      if (addAnimationTokenRef.current !== animationToken) return;
      setAddingToQueue(false);
      onAdd();
    }, totalDuration);
  };

  const draggedNovel = selectedNovels.find((novel) => novel.id === dragId);

  return (
    <section className="discover-sidebar-panel queue-panel">
      <div className="panel-header">
        <div>
          <h2>Capitulos</h2>
          <span>{selectedNovels.length === 0 ? "Selecione livros" : `${selectedNovels.length} livro(s)`}</span>
        </div>
        <button
          className="button primary compact"
          disabled={selectedNovels.length === 0 || addingToQueue}
          onClick={handleAdd}
          aria-busy={addingToQueue}
        >
          <Download size={15} />
          {addingToQueue ? "Enviando..." : "Adicionar a fila"}
        </button>
      </div>
      {!addingToQueue && selectedNovels.length > 1 ? (
        <p className="reorder-hint">
          <GripVertical size={13} />
          Arraste pela alca para priorizar (topo = primeiro)
        </p>
      ) : null}
      <div className="selection-list" ref={listRef}>
        {dragId && dropY != null ? <div className="drop-line" style={{ top: dropY }} aria-hidden="true" /> : null}
        {selectedNovels.length === 0 ? (
          <div className="empty-state compact">
            <BookOpen size={18} />
            <span>Clique em um card para configurar capitulos.</span>
          </div>
        ) : !addingToQueue ? (
          selectedNovels.map((novel) => {
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
                className={`selection-card ${expanded ? "expanded" : "collapsed"} ${dragId === novel.id ? "dragging" : ""}`}
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
        ) : (
          null
        )}
      </div>
      {dragPreview && draggedNovel ? createPortal(
        <div
          className="selection-drag-preview"
          style={{
            left: dragPreview.x - dragPreview.offsetX,
            top: dragPreview.y - dragPreview.offsetY,
            width: dragPreview.width
          }}
        >
          <GripVertical size={15} />
          <div className="selection-title">
            <strong>{draggedNovel.title}</strong>
            <small>{draggedNovel.chapters.toLocaleString("pt-BR")} capitulos</small>
          </div>
        </div>,
        document.body
      ) : null}
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
      <section className="discover-sidebar-panel discover-detail-panel empty">
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
    <section className="discover-sidebar-panel discover-detail-panel">
      <div className="panel-header discover-detail-header">
        <div>
          <h2>Detalhes</h2>
          <span>{preview ? "Pre-visualizacao temporaria" : "Ultima novel selecionada"}</span>
        </div>
      </div>
      <div
        className={`book-cover detail-cover ${novel.coverClass}`}
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
        <h3>Sinopse</h3>
        <p>{novel.description.trim() || "Sem sinopse cadastrada para esta novel."}</p>
      </div>
    </section>
  );
}

export function DiscoverView({
  sources,
  filters,
  results,
  selectedNovels,
  loading,
  selectedIds,
  detailNovel,
  detailFromPreview,
  filterCollapsed,
  selections,
  onFiltersChange,
  onToggleFilters,
  onToggleNovel,
  onSelectNovel,
  onPreviewNovel,
  onClearPreview,
  onSelectionChange,
  onAddSelected,
  onReorder,
  onRemoveSelected
}: {
  sources: SourceSite[];
  filters: Filters;
  results: Novel[];
  selectedNovels: Novel[];
  loading: boolean;
  selectedIds: string[];
  detailNovel?: Novel;
  detailFromPreview: boolean;
  filterCollapsed: boolean;
  selections: Record<string, ChapterSelection>;
  onFiltersChange: (filters: Filters) => void;
  onToggleFilters: () => void;
  onToggleNovel: (novel: Novel) => void;
  onSelectNovel: (novel: Novel) => void;
  onPreviewNovel: (novel: Novel) => void;
  onClearPreview: () => void;
  onSelectionChange: (selection: ChapterSelection) => void;
  onAddSelected: () => void;
  onReorder: (orderedIds: string[]) => void;
  onRemoveSelected: (novelId: string) => void;
}) {
  const pageSize = 60;
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const [dragState, setDragState] = useState({ active: false, overTrash: false });
  const [sidebarTab, setSidebarTab] = useState<DiscoverSidebarTab>("queue");
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => setVisibleCount(pageSize), [results]);
  useEffect(() => {
    if (detailFromPreview) {
      contentRef.current?.focus();
    }
  }, [detailFromPreview]);
  useEffect(() => {
    if (!selectedNovels.length && !detailFromPreview) {
      setSidebarTab("queue");
      return;
    }
  }, [detailFromPreview, selectedNovels.length]);
  const visibleResults = results.slice(0, visibleCount);
  const handleSelectNovel = (novel: Novel) => {
    setSidebarTab("details");
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
          onChange={onFiltersChange}
          onBackgroundClick={handleFilterBackgroundClick}
        />
      ) : null}
      <section
        className={`content-area ${dragState.active ? "drop-delete" : ""} ${dragState.overTrash ? "drop-delete-over" : ""}`}
        ref={contentRef}
        tabIndex={detailFromPreview ? 0 : -1}
        onClick={handleContentClick}
        onKeyDown={handleContentKeyDown}
      >
        {dragState.active ? (
          <div className={`content-delete-overlay ${dragState.overTrash ? "over" : ""}`} aria-hidden="true">
            <Trash2 size={30} />
            <strong>Solte para remover</strong>
          </div>
        ) : null}
        <div className="toolbar">
          <div>
            <h2>Resultados</h2>
            <span>
              {loading
                ? "Buscando..."
                : `${Math.min(visibleCount, results.length)} de ${results.length} livros`}
            </span>
          </div>
          <div className="toolbar-actions">
            <button className="button quiet" onClick={onToggleFilters}>
              <SlidersHorizontal size={16} />
              {filterCollapsed ? "Filtros" : "Ocultar filtros"}
            </button>
          </div>
        </div>

        <div className="active-filter-row">
          <span>{sources.find((source) => source.id === filters.sourceId)?.name ?? "Fonte obrigatoria"}</span>
          {filters.tags.map((tag) => <span key={tag}>{tag}</span>)}
          <span>{filters.language.toUpperCase()}</span>
          <button onClick={() => onFiltersChange(defaultFilters(filters.sourceId))}>Limpar</button>
        </div>

        {loading ? (
          <SkeletonGrid />
        ) : (
          <div className="book-grid compact">
            {visibleResults.map((novel) => (
              <NovelCard
                key={novel.id}
                novel={novel}
                selected={selectedIds.includes(novel.id)}
                focused={detailNovel?.id === novel.id}
                onToggle={() => onToggleNovel(novel)}
                onSelect={() => handleSelectNovel(novel)}
                onPreview={() => handlePreviewNovel(novel)}
              />
            ))}
            {visibleCount < results.length ? (
              <div className="results-more">
                <button className="button quiet" onClick={() => setVisibleCount((count) => count + pageSize)}>
                  Mostrar mais
                </button>
              </div>
            ) : null}
          </div>
        )}

      </section>
      {selectedNovels.length > 0 || detailFromPreview ? (
        <aside className="selection-drawer discover-sidebar">
          <div className="discover-sidebar-tabs" role="tablist" aria-label="Painel lateral da descoberta">
            <button
              className={`discover-sidebar-tab ${sidebarTab === "queue" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "queue"}
              disabled={selectedNovels.length === 0}
              onClick={() => setSidebarTab("queue")}
            >
              Fila
              {selectedNovels.length > 0 ? <span>{selectedNovels.length}</span> : null}
            </button>
            <button
              className={`discover-sidebar-tab ${sidebarTab === "details" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "details"}
              disabled={!detailNovel}
              onClick={() => setSidebarTab("details")}
            >
              Detalhes
            </button>
          </div>
          {sidebarTab === "queue" ? (
            <SelectionConfigurator
              selectedNovels={selectedNovels}
              selections={selections}
              onChange={onSelectionChange}
              onAdd={onAddSelected}
              onReorder={onReorder}
              onRemove={onRemoveSelected}
              trashRef={contentRef}
              onDragStateChange={(active, overTrash) => setDragState({ active, overTrash })}
            />
          ) : (
            <DiscoverDetailsPanel novel={detailNovel} preview={detailFromPreview} />
          )}
        </aside>
      ) : null}
    </>
  );
}
