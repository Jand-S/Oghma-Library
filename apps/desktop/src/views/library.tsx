import { ExternalLink, FolderOpen } from "lucide-react";
import type { LibraryItem } from "../core/types";

export function LibraryView({ library, onOpenFolder }: { library: LibraryItem[]; onOpenFolder: () => void }) {
  return (
    <section className="page-area full-span">
      <div className="page-header">
        <button className="button quiet" onClick={onOpenFolder}>
          <FolderOpen size={16} />
          Abrir pasta
        </button>
      </div>
      <div className="library-grid">
        {library.map((item) => (
          <article className="library-card" key={item.id}>
            <div
              className={`book-cover ${item.coverClass}`}
              style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
            />
            <div>
              <strong>{item.title}</strong>
              <small>{item.author}</small>
              <p>{(item.formats?.length ? item.formats : [item.format]).join(", ")} - {item.chapters || "?"} capitulos - {item.sizeMb} MB</p>
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
