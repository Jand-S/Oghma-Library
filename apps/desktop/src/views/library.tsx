import {
  Check,
  FolderOpen,
  RefreshCcw,
  Search
} from "lucide-react";
import { useMemo, useState } from "react";
import type { DownloadFormat, LibraryItem } from "../core/types";

type LibraryViewProps = {
  library: LibraryItem[];
  selectedIds: string[];
  onToggleSelect: (id: string) => void;
  onConvertSelected: () => void;
  onOpenItemFolder: (item: LibraryItem) => void;
};

const formatOptions: Array<DownloadFormat | "all"> = ["all", "EPUB", "PDF", "TXT", "AZW3"];

function hasFormat(item: LibraryItem, format: DownloadFormat | "all") {
  if (format === "all") return true;
  return (item.formats?.length ? item.formats : [item.format]).includes(format);
}

export function LibraryView({
  library,
  selectedIds,
  onToggleSelect,
  onConvertSelected,
  onOpenItemFolder
}: LibraryViewProps) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<DownloadFormat | "all">("all");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return library.filter((item) => {
      const textMatch = normalized.length === 0
        || item.title.toLowerCase().includes(normalized)
        || item.author.toLowerCase().includes(normalized)
        || item.sourceName?.toLowerCase().includes(normalized);
      return textMatch && hasFormat(item, format);
    });
  }, [format, library, query]);

  const selectedItem = filtered.find((item) => selectedIds.includes(item.id));
  const selectedCount = selectedItem ? 1 : 0;

  const selectItem = (item: LibraryItem) => {
    onToggleSelect(item.id);
  };

  return (
    <section className={`library-workspace full-span ${selectedItem ? "detail-open" : ""}`}>
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
        <div className="library-summary-box">
          <strong>{filtered.length}</strong>
          <span>livro(s) encontrados</span>
        </div>
      </aside>

      <section className="library-results">
        <div className="pane-header">
          <div>
            <h3>Biblioteca local</h3>
            <span>{selectedCount > 0 ? `${selectedCount} selecionado(s)` : `${library.length} livro(s)`}</span>
          </div>
          <div className="pane-actions">
            <button className="button primary compact" onClick={onConvertSelected} disabled={selectedCount === 0}>
              <RefreshCcw size={15} />
              Converter
            </button>
          </div>
        </div>
        <div className="library-book-grid">
          {filtered.length === 0 ? (
            <div className="empty-state compact">Nenhum livro encontrado na pasta de saida.</div>
          ) : (
            filtered.map((item) => {
              const selected = selectedIds.includes(item.id);
              return (
                <article
                  className={`library-book-card ${selected ? "selected" : ""}`}
                  key={item.id}
                  role="button"
                  aria-pressed={selected}
                  onClick={() => selectItem(item)}
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
                    className={`queue-thumb ${item.coverClass}`}
                    style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  />
                  <div className="book-info">
                    <strong>{item.title}</strong>
                    <small>{item.author}</small>
                    <p>{item.chapters ? `${item.chapters.toLocaleString("pt-BR")} capitulos` : "Capitulos locais"}</p>
                  </div>
                  <div className="queue-badges">
                    {(item.formats?.length ? item.formats : [item.format]).map((itemFormat) => (
                      <span className="badge" key={itemFormat} title={item.files?.filter((file) => file.toLowerCase().endsWith(`.${itemFormat.toLowerCase()}`)).join(", ") || itemFormat}>
                        {itemFormat}
                      </span>
                    ))}
                  </div>
                  <button
                    className="icon-button small library-folder-button"
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

      {selectedItem ? (
        <aside className="library-detail-panel">
          <>
            <div
              className={`book-cover detail-cover ${selectedItem.coverClass}`}
              style={selectedItem.coverUrl ? { backgroundImage: `url("${selectedItem.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            />
            <h2>{selectedItem.title}</h2>
            <span>{selectedItem.author}</span>
            <div className="queue-badges">
              {(selectedItem.formats?.length ? selectedItem.formats : [selectedItem.format]).map((itemFormat) => (
                <span className="badge" key={itemFormat}>{itemFormat}</span>
              ))}
            </div>
            <div className="library-detail-meta">
              <span>{selectedItem.sourceName ?? "Fonte local"}</span>
              <span>{selectedItem.sizeMb} MB</span>
            </div>
            <div className="library-synopsis">
              <h3>Sinopse</h3>
              <p>{selectedItem.description?.trim() || "Sem sinopse local para este livro. Quando o item vier de um indice conhecido, a sinopse aparece aqui."}</p>
            </div>
          </>
        </aside>
      ) : null}
    </section>
  );
}
