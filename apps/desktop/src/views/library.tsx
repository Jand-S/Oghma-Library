import {
  Check,
  FolderOpen,
  GripVertical,
  Heart,
  Headphones,
  Languages,
  Plus,
  RefreshCcw,
  Search,
  Send,
  SlidersHorizontal,
  Trash2,
  X
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DownloadFormat, LibraryItem, LibraryMeta, LibraryReadingStatus } from "../core/types";
import { downloadFormats } from "../core/types";

type LibraryViewProps = {
  library: LibraryItem[];
  kindleConnected: boolean;
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onRemoveSelected: (id: string) => void;
  onReorderSelected: (ids: string[]) => void;
  conversionFormats: Set<DownloadFormat>;
  conversionTranslate: boolean;
  conversionAudiobook: boolean;
  conversionProgress: number;
  conversionRunning: boolean;
  conversionCurrentItemId: string | null;
  onConvertSelected: () => void;
  onToggleConversionFormat: (format: DownloadFormat) => void;
  onToggleConversionTranslate: () => void;
  onToggleConversionAudiobook: () => void;
  onOpenItemFolder: (item: LibraryItem) => void;
  onUpdateMeta: (item: LibraryItem, patch: Partial<Omit<LibraryMeta, "key">>) => void;
  onDeleteItems: (items: LibraryItem[], deleteFiles: boolean) => void;
};
type LibrarySidebarTab = "queue" | "details";

const formatOptions: Array<DownloadFormat | "all"> = ["all", "EPUB", "PDF", "TXT", "AZW3"];
const statusOptions: Array<LibraryReadingStatus | "all" | "favorite"> = ["all", "favorite", "unread", "reading", "paused", "completed", "dropped"];
const readingStatusLabels: Record<LibraryReadingStatus, string> = {
  unread: "Não iniciado",
  reading: "Lendo",
  paused: "Pausado",
  completed: "Concluído",
  dropped: "Dropado"
};

function hasFormat(item: LibraryItem, format: DownloadFormat | "all") {
  if (format === "all") return true;
  return (item.formats?.length ? item.formats : [item.format]).includes(format);
}

export function LibraryView({
  library,
  kindleConnected,
  selectedIds,
  onToggleSelect,
  onRemoveSelected,
  onReorderSelected,
  conversionFormats,
  conversionTranslate,
  conversionAudiobook,
  conversionProgress,
  conversionRunning,
  conversionCurrentItemId,
  onConvertSelected,
  onToggleConversionFormat,
  onToggleConversionTranslate,
  onToggleConversionAudiobook,
  onOpenItemFolder,
  onUpdateMeta,
  onDeleteItems
}: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<DownloadFormat | "all">("all");
  const [statusFilter, setStatusFilter] = useState<LibraryReadingStatus | "all" | "favorite">("all");
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<LibrarySidebarTab>("queue");
  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null);
  const [tagInput, setTagInput] = useState("");
  const [deleteChoiceItems, setDeleteChoiceItems] = useState<LibraryItem[] | null>(null);
  const selectedListRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const positionsRef = useRef(new Map<string, DOMRect>());
  const dragIdRef = useRef<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<{
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
    width: number;
  } | null>(null);
  const [dropY, setDropY] = useState<number | null>(null);
  const [dragOverTrash, setDragOverTrash] = useState(false);
  const hasQueryFilter = query.trim().length > 0;
  const hasFormatFilter = format !== "all";
  const hasStatusFilter = statusFilter !== "all";
  const hasActiveFilters = hasQueryFilter || hasFormatFilter || hasStatusFilter;

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return library.filter((item) => {
      const tags = item.personalTags ?? [];
      const textMatch = normalized.length === 0
        || item.title.toLowerCase().includes(normalized)
        || item.author.toLowerCase().includes(normalized)
        || item.sourceName?.toLowerCase().includes(normalized)
        || tags.some((tag) => tag.toLowerCase().includes(normalized));
      const statusMatch = statusFilter === "all"
        || (statusFilter === "favorite" ? item.favorite : (item.readingStatus ?? "unread") === statusFilter);
      return textMatch && statusMatch && hasFormat(item, format);
    });
  }, [format, library, query, statusFilter]);

  const selectedItems = selectedIds
    .map((id) => library.find((item) => item.id === id))
    .filter((item): item is LibraryItem => Boolean(item));
  const selectedItem = selectedItems[selectedItems.length - 1];
  const detailItem = previewItem ?? selectedItem;
  const detailFromPreview = Boolean(previewItem);
  const selectedCount = selectedItems.length;
  const deleteCount = deleteChoiceItems?.length ?? 0;
  const resultSummary = `${filtered.length} de ${library.length} livro(s)${selectedCount > 0 ? ` - ${selectedCount} selecionado(s)` : ""}`;
  const currentConversionIndex = conversionCurrentItemId ? selectedItems.findIndex((item) => item.id === conversionCurrentItemId) : -1;
  const draggedItem = selectedItems.find((item) => item.id === dragId);

  useLayoutEffect(() => {
    const cards = selectedListRef.current?.querySelectorAll<HTMLElement>("[data-library-queue-id]");
    if (!cards) return;
    const next = new Map<string, DOMRect>();
    cards.forEach((card) => {
      const id = card.dataset.libraryQueueId;
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
  }, [selectedIds]);

  const selectItem = (item: LibraryItem) => {
    setPreviewItem(null);
    setSidebarTab("details");
    onToggleSelect(item.id);
  };
  const previewOnly = (item: LibraryItem) => {
    setPreviewItem(item);
    setSidebarTab("details");
  };
  const clearPreview = () => setPreviewItem(null);
  const clearFilters = () => {
    setQuery("");
    setFormat("all");
    setStatusFilter("all");
  };
  const selectedTags = detailItem?.personalTags ?? [];
  const addSelectedTag = () => {
    if (!detailItem) return;
    const value = tagInput.trim();
    if (!value) return;
    const exists = selectedTags.some((tag) => tag.toLowerCase() === value.toLowerCase());
    if (!exists) {
      onUpdateMeta(detailItem, { tags: [...selectedTags, value] });
    }
    setTagInput("");
  };
  const removeSelectedTag = (tag: string) => {
    if (!detailItem) return;
    onUpdateMeta(detailItem, { tags: selectedTags.filter((item) => item !== tag) });
  };
  const computeQueueDropIndex = (clientY: number): number => {
    const cards = Array.from(selectedListRef.current?.querySelectorAll<HTMLElement>("[data-library-queue-id]") ?? []);
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return cards.length;
  };
  const lineYForQueueIndex = (index: number): number | null => {
    const list = selectedListRef.current;
    if (!list) return null;
    const cards = Array.from(list.querySelectorAll<HTMLElement>("[data-library-queue-id]"));
    if (cards.length === 0) return null;
    const listTop = list.getBoundingClientRect().top;
    if (index >= cards.length) {
      const last = cards[cards.length - 1].getBoundingClientRect();
      return last.bottom - listTop + list.scrollTop;
    }
    const rect = cards[index].getBoundingClientRect();
    return rect.top - listTop + list.scrollTop;
  };
  const startQueueDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (conversionRunning) return;
    const card = event.currentTarget.closest("[data-library-queue-id]") as HTMLElement | null;
    const id = card?.getAttribute("data-library-queue-id") ?? null;
    if (!id || !card) return;
    event.preventDefault();
    const pointerId = event.pointerId;
    try { card.setPointerCapture(pointerId); } catch { /* window listeners keep the drag alive */ }
    const rect = card.getBoundingClientRect();
    dragIdRef.current = id;
    setDragId(id);
    setDragPreview({
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width
    });
    setDragOverTrash(false);

    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      try { card.releasePointerCapture(pointerId); } catch { /* ignore */ }
      dragIdRef.current = null;
      setDragId(null);
      setDragPreview(null);
      setDropY(null);
      setDragOverTrash(false);
    };

    const overTrash = (clientX: number, clientY: number) => {
      const rect = resultsRef.current?.getBoundingClientRect();
      return Boolean(rect && clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom);
    };

    function onMove(moveEvent: PointerEvent) {
      setDragPreview((current) => current ? { ...current, x: moveEvent.clientX, y: moveEvent.clientY } : current);
      const removing = overTrash(moveEvent.clientX, moveEvent.clientY);
      setDragOverTrash(removing);
      setDropY(removing ? null : lineYForQueueIndex(computeQueueDropIndex(moveEvent.clientY)));
    }

    function onUp(upEvent: PointerEvent) {
      const from = dragIdRef.current;
      const droppedInTrash = overTrash(upEvent.clientX, upEvent.clientY);
      let reordered: string[] | null = null;
      if (from && !droppedInTrash) {
        const order = selectedItems.map((item) => item.id);
        const fromIndex = order.indexOf(from);
        let target = computeQueueDropIndex(upEvent.clientY);
        if (fromIndex !== -1 && fromIndex < target) target -= 1;
        const without = order.filter((id) => id !== from);
        target = Math.max(0, Math.min(without.length, target));
        const next = [...without];
        next.splice(target, 0, from);
        if (next.some((value, index) => value !== order[index])) reordered = next;
      }
      finish();
      if (from && droppedInTrash) onRemoveSelected(from);
      else if (reordered) onReorderSelected(reordered);
    }

    function onCancel() {
      finish();
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };
  const handleBackgroundClick = (event: ReactMouseEvent<HTMLElement>) => {
    if (!previewItem) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(".library-book-card, button, input, select, label, .library-sidebar")) return;
    if (target.closest(".library-results, .library-filter-panel")) {
      clearPreview();
    }
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && previewItem) {
      event.preventDefault();
      clearPreview();
    }
  };

  return (
    <section
      className={`library-workspace full-span ${filtersCollapsed ? "filters-hidden" : ""} ${detailItem || selectedCount > 0 ? "detail-open" : ""}`}
      tabIndex={previewItem ? 0 : -1}
      onClick={handleBackgroundClick}
      onKeyDown={handleKeyDown}
    >
      {!filtersCollapsed ? (
        <aside className="filter-panel library-filter-panel">
          <div className="panel-header">
            <div>
              <h2>Filtros</h2>
              <span>Biblioteca local</span>
            </div>
          </div>
          <div className="field-group">
            <label htmlFor="library-query">Busca</label>
            <div className="input-with-icon">
              <Search size={16} />
              <input id="library-query" value={query} onChange={(event) => setQuery(event.target.value)} />
            </div>
          </div>
          <div className="field-group">
            <label htmlFor="library-format">Formato</label>
            <select id="library-format" value={format} onChange={(event) => setFormat(event.target.value as DownloadFormat | "all")}>
              {formatOptions.map((option) => (
                <option value={option} key={option}>
                  {option === "all" ? "Todos" : option}
                </option>
              ))}
            </select>
          </div>
          <div className="field-group">
            <label htmlFor="library-status">Marcador</label>
            <select id="library-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as LibraryReadingStatus | "all" | "favorite")}>
              {statusOptions.map((option) => (
                <option value={option} key={option}>
                  {option === "all" ? "Todos" : option === "favorite" ? "Favoritos" : readingStatusLabels[option]}
                </option>
              ))}
            </select>
          </div>
        </aside>
      ) : null}

      <section
        className={`library-results ${dragId ? "drop-delete" : ""} ${dragOverTrash ? "drop-delete-over" : ""}`}
        ref={resultsRef}
      >
        {dragId ? (
          <div className={`content-delete-overlay ${dragOverTrash ? "over" : ""}`} aria-hidden="true">
            <Trash2 size={28} />
            <strong>Solte para remover</strong>
            <span>Remove o livro da fila de conversao.</span>
          </div>
        ) : null}
        <div className="toolbar library-toolbar">
          <div>
            <h2>Livros</h2>
            <span>{resultSummary}</span>
          </div>
          <div className="toolbar-actions">
            {selectedCount > 0 ? (
              <button
                className="toolbar-control library-trash-control"
                onClick={() => setDeleteChoiceItems(selectedItems)}
                title="Excluir selecionados"
                aria-label={`Excluir ${selectedCount} livro(s) selecionado(s)`}
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </div>
        </div>

        <div className="active-filter-row library-active-filter-row">
          <button
            className={`toolbar-control filter-row-toggle ${!filtersCollapsed || hasActiveFilters ? "active" : ""}`}
            onClick={() => setFiltersCollapsed((value) => !value)}
            title={filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
            aria-label={filtersCollapsed ? "Mostrar filtros" : "Ocultar filtros"}
          >
            <SlidersHorizontal size={13} />
          </button>
          {hasQueryFilter ? (
            <button className="quick-filter-pill clearable" onClick={() => setQuery("")} title="Busca ativa. Clique para limpar.">
              Busca: {query.trim()}
            </button>
          ) : null}
          {hasFormatFilter ? (
            <button className="quick-filter-pill clearable" onClick={() => setFormat("all")} title="Formato ativo. Clique para voltar para todos.">
              Formato: {format}
            </button>
          ) : null}
          {hasStatusFilter ? (
            <button className="quick-filter-pill clearable" onClick={() => setStatusFilter("all")} title="Marcador ativo. Clique para voltar para todos.">
              {statusFilter === "favorite" ? "Favoritos" : readingStatusLabels[statusFilter]}
            </button>
          ) : null}
          {selectedCount > 0 ? <span>{selectedCount} selecionado</span> : null}
          {hasActiveFilters ? <button onClick={clearFilters}>Limpar</button> : null}
        </div>

        <div className="library-book-grid">
          {filtered.length === 0 ? (
            <div className="results-empty-state library-empty-state">
              <strong>Nenhum livro encontrado</strong>
              <span>Ajuste a busca ou o formato para ver outros itens da biblioteca.</span>
              {hasActiveFilters ? <button className="button quiet" onClick={clearFilters}>Limpar filtros</button> : null}
            </div>
          ) : (
            filtered.map((item) => {
              const selected = selectedIds.includes(item.id);
              const formats = item.formats?.length ? item.formats : [item.format];
              const visibleFormats = formats.length > 2 ? [formats[0]] : formats;
              const hiddenFormatCount = formats.length - visibleFormats.length;
              const readingStatus = item.readingStatus ?? "unread";
              const visibleTags = (item.personalTags ?? []).slice(0, 2);
              return (
                <article
                  className={`book-card library-book-card ${selected ? "selected" : ""}`}
                  key={item.id}
                  role="button"
                  aria-pressed={selected}
                  onClick={() => selectItem(item)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    previewOnly(item);
                  }}
                >
                  <button
                    className={`card-check ${selected ? "active" : ""}`}
                    aria-label={`Selecionar ${item.title}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      selectItem(item);
                    }}
                  >
                    {selected ? <Check size={11} /> : null}
                  </button>
                  <div
                    className={`book-cover ${item.coverClass}`}
                    style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  />
                  <div className="book-info">
                    <strong>{item.title}</strong>
                    {item.author ? <small>{item.author}</small> : null}
                    <p>{item.chapters ? `${item.chapters.toLocaleString("pt-BR")} capitulos` : `${item.sizeMb} MB locais`}</p>
                  </div>
                  <div className="library-card-markers">
                    {item.favorite ? <span className="library-marker favorite"><Heart size={10} /> Favorito</span> : null}
                    <span className={`library-marker status-${readingStatus}`}>{readingStatusLabels[readingStatus]}</span>
                    {visibleTags.map((tag) => <span className="library-marker" key={tag}>{tag}</span>)}
                  </div>
                  <div className="queue-badges">
                    {visibleFormats.map((itemFormat) => (
                      <span className="badge" key={itemFormat} title={item.files?.filter((file) => file.toLowerCase().endsWith(`.${itemFormat.toLowerCase()}`)).join(", ") || itemFormat}>
                        {itemFormat}
                      </span>
                    ))}
                    {hiddenFormatCount > 0 ? (
                      <span className="badge" title={formats.join(", ")}>+{hiddenFormatCount}</span>
                    ) : null}
                  </div>
                </article>
              );
            })
          )}
        </div>
      </section>

      {detailItem || selectedCount > 0 ? (
        <aside className="library-detail-panel library-sidebar">
          <div className="discover-sidebar-tabs" role="tablist" aria-label="Biblioteca lateral">
            <button
              className={`discover-sidebar-tab ${sidebarTab === "queue" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "queue"}
              onClick={() => setSidebarTab("queue")}
            >
              Fila <span>{selectedCount}</span>
            </button>
            <button
              className={`discover-sidebar-tab ${sidebarTab === "details" ? "active" : ""}`}
              role="tab"
              aria-selected={sidebarTab === "details"}
              onClick={() => setSidebarTab("details")}
            >
              Detalhes
            </button>
          </div>

          {sidebarTab === "queue" ? (
            <div className="library-conversion-queue">
              <div className="library-detail-heading">
                <div>
                  <h3>{kindleConnected ? "Envio ao Kindle" : "Conversão"}</h3>
                  <span>{selectedCount} livro(s) selecionado(s)</span>
                </div>
              </div>
              <div className="library-conversion-section">
                <span className="field-caption">Formatos</span>
                <div className="format-options library-format-options">
                  {downloadFormats.map((itemFormat) => (
                    <button
                      key={itemFormat}
                      className={`format-chip ${conversionFormats.has(itemFormat) ? "active" : ""}`}
                      aria-pressed={conversionFormats.has(itemFormat)}
                      onClick={() => onToggleConversionFormat(itemFormat)}
                      disabled={conversionRunning || (kindleConnected && itemFormat !== "AZW3")}
                      title={kindleConnected && itemFormat !== "AZW3" ? "O Kindle recebera apenas AZW3" : itemFormat}
                    >
                      {itemFormat}
                    </button>
                  ))}
                </div>
              </div>
              <div className="library-conversion-section library-conversion-modifiers">
                <span className="field-caption">Extras</span>
                <div className="selection-options">
                  <button className={`option-toggle ${conversionTranslate ? "active" : ""}`} onClick={onToggleConversionTranslate} disabled={conversionRunning}>
                    <Languages size={13} />
                    Traduzir
                  </button>
                  <button
                    className={`option-toggle ${conversionAudiobook ? "active" : ""}`}
                    onClick={onToggleConversionAudiobook}
                    disabled={conversionRunning || kindleConnected}
                    title={kindleConnected ? "Audiobook nao faz parte do envio ao Kindle" : "Gerar audiobook"}
                  >
                    <Headphones size={13} />
                    Audiobook
                  </button>
                </div>
              </div>
              <div className="kindle-progress-block library-conversion-progress">
                <div className="kindle-progress-header">
                  <strong>{conversionRunning ? (kindleConnected ? "Preparando e enviando" : "Convertendo") : (kindleConnected ? "Pronto para enviar" : "Pronto para converter")}</strong>
                  <span>{Math.round(conversionProgress)}%</span>
                </div>
                <div className="progress"><span style={{ width: `${conversionProgress}%` }} /></div>
              </div>
              {!conversionRunning && selectedItems.length > 1 ? (
                <p className="reorder-hint">
                  <GripVertical size={13} />
                  Arraste pela alca para reordenar ou solte nos resultados para remover.
                </p>
              ) : null}
              <div className="selection-list library-selected-list" ref={selectedListRef}>
                {dragId && dropY != null ? <div className="drop-line" style={{ top: dropY }} aria-hidden="true" /> : null}
                {selectedItems.length === 0 ? (
                  <div className="empty-state compact">Selecione livros para montar a fila.</div>
                ) : selectedItems.map((item, index) => {
                  const active = conversionRunning && item.id === conversionCurrentItemId;
                  const done = conversionRunning && currentConversionIndex >= 0 && index < currentConversionIndex;
                  const pending = conversionRunning && currentConversionIndex >= 0 && index > currentConversionIndex;
                  return (
                    <article
                      className={`selection-card library-selected-card collapsed ${dragId === item.id ? "dragging" : ""} ${active ? "running" : ""} ${done ? "done" : ""}`}
                      key={item.id}
                      data-library-queue-id={item.id}
                    >
                      <span
                        className={`drag-handle ${conversionRunning ? "disabled" : ""}`}
                        title={conversionRunning ? "Aguarde a conversao terminar" : "Arraste para reordenar ou remover"}
                        aria-label="Arraste para reordenar ou remover"
                        onPointerDown={startQueueDrag}
                      >
                        <GripVertical size={15} />
                      </span>
                      <div
                        className={`queue-thumb ${item.coverClass}`}
                        style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                      />
                      <div className="queue-body">
                        <strong>{item.title}</strong>
                        {active ? <div className="progress thin"><span style={{ width: `${conversionProgress}%` }} /></div> : null}
                        <p>{active ? (kindleConnected ? "Preparando para envio" : "Convertendo agora") : done ? "Concluído nesta rodada" : pending ? "Aguardando" : `${item.sizeMb} MB locais`}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
              <button className="button primary queue-add-button library-convert-button" onClick={onConvertSelected} disabled={selectedCount === 0 || conversionRunning}>
                {kindleConnected ? <Send size={15} /> : <RefreshCcw size={15} />}
                {conversionRunning
                  ? (kindleConnected ? "Enviando..." : "Convertendo...")
                  : (kindleConnected ? "Enviar para o Kindle" : "Converter fila")}
              </button>
            </div>
          ) : detailItem ? (
            <>
              <div className="library-detail-heading">
                <div>
                  <h3>Detalhes</h3>
                  <span>{detailFromPreview ? "Pré-visualização" : "Último selecionado"}</span>
                </div>
                <button
                  className="toolbar-control"
                  title="Abrir pasta deste livro"
                  aria-label={`Abrir pasta de ${detailItem.title}`}
                  onClick={() => onOpenItemFolder(detailItem)}
                >
                  <FolderOpen size={15} />
                </button>
              </div>
              <div
                className={`book-cover detail-cover ${detailItem.coverClass}`}
                style={detailItem.coverUrl ? { backgroundImage: `url("${detailItem.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              />
              <h2>{detailItem.title}</h2>
              {detailItem.author ? <span>{detailItem.author}</span> : null}
              <div className="library-personal-actions">
                <button
                  className={`button quiet compact ${detailItem.favorite ? "active" : ""}`}
                  onClick={() => onUpdateMeta(detailItem, { favorite: !detailItem.favorite })}
                >
                  <Heart size={14} />
                  {detailItem.favorite ? "Favorito" : "Favoritar"}
                </button>
                <button className="button danger compact" onClick={() => setDeleteChoiceItems([detailItem])}>
                  <Trash2 size={14} />
                  Excluir
                </button>
              </div>
              <div className="field-group library-detail-field">
                <label htmlFor="library-reading-status">Status de leitura</label>
                <select
                  id="library-reading-status"
                  value={detailItem.readingStatus ?? "unread"}
                  onChange={(event) => onUpdateMeta(detailItem, { readingStatus: event.target.value as LibraryReadingStatus })}
                >
                  {statusOptions.filter((option): option is LibraryReadingStatus => option !== "all" && option !== "favorite").map((option) => (
                    <option value={option} key={option}>{readingStatusLabels[option]}</option>
                  ))}
                </select>
              </div>
              <div className="library-tags-editor">
                <div className="library-tags-editor-head">
                  <h3>Marcadores</h3>
                  <span>{selectedTags.length} tag(s)</span>
                </div>
                <div className="library-tag-list">
                  {selectedTags.length === 0 ? <span className="muted-tag-pill">Sem marcadores</span> : null}
                  {selectedTags.map((tag) => (
                    <button className="tag-token" key={tag} onClick={() => removeSelectedTag(tag)} title="Remover marcador">
                      {tag}
                      <X size={11} />
                    </button>
                  ))}
                </div>
                <div className="library-tag-input-row">
                  <input
                    value={tagInput}
                    placeholder="Adicionar tag"
                    onChange={(event) => setTagInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        addSelectedTag();
                      }
                    }}
                  />
                  <button className="toolbar-control" onClick={addSelectedTag} title="Adicionar marcador" aria-label="Adicionar marcador">
                    <Plus size={14} />
                  </button>
                </div>
              </div>
              <div className="queue-badges">
                {(detailItem.formats?.length ? detailItem.formats : [detailItem.format]).map((itemFormat) => (
                  <span className="badge" key={itemFormat}>{itemFormat}</span>
                ))}
              </div>
              <div className="library-detail-meta">
                <span>{detailItem.sourceName ?? "Fonte local"}</span>
                {detailItem.chapters ? <span>{detailItem.chapters.toLocaleString("pt-BR")} capitulos</span> : null}
                <span>{detailItem.sizeMb} MB</span>
              </div>
              <div className="library-synopsis">
                <h3>Sinopse</h3>
                <p>{detailItem.description?.trim() || "Sem sinopse local para este livro. Quando o item vier de um indice conhecido, a sinopse aparece aqui."}</p>
              </div>
            </>
          ) : (
            <div className="empty-state compact">Selecione ou pré-visualize um livro.</div>
          )}
        </aside>
      ) : null}
      {dragPreview && draggedItem ? createPortal(
        <div
          className="selection-drag-preview library-drag-preview"
          style={{
            left: dragPreview.x - dragPreview.offsetX,
            top: dragPreview.y - dragPreview.offsetY,
            width: dragPreview.width
          }}
        >
          <GripVertical size={15} />
          <div className="selection-title">
            <strong>{draggedItem.title}</strong>
            <small>{draggedItem.sizeMb} MB locais</small>
          </div>
        </div>,
        document.body
      ) : null}
      {deleteChoiceItems && deleteCount > 0 ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel library-delete-modal" role="dialog" aria-modal="true" aria-labelledby="library-delete-title">
            <div className="modal-header">
              <div>
                <h2 id="library-delete-title">Excluir da biblioteca</h2>
                <p>{deleteCount === 1 ? deleteChoiceItems[0].title : `${deleteCount} livros selecionados`}</p>
              </div>
              <button className="icon-button small" onClick={() => setDeleteChoiceItems(null)} aria-label="Fechar exclusao">
                <X size={15} />
              </button>
            </div>
            <p className="library-delete-copy">
              Escolha se os livros devem apenas sumir da biblioteca local ou se as pastas com EPUB/TXT/HTML/imagens tambem devem ser apagadas.
            </p>
            <div className="library-delete-actions">
              <button
                className="button quiet"
                onClick={() => {
                  onDeleteItems(deleteChoiceItems, false);
                  setDeleteChoiceItems(null);
                }}
              >
                Remover da biblioteca
              </button>
              <button
                className="button danger"
                onClick={() => {
                  onDeleteItems(deleteChoiceItems, true);
                  setDeleteChoiceItems(null);
                }}
              >
                Excluir tudo
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
