import { Loader2, RefreshCcw } from "lucide-react";
import type { SourceSite } from "../core/types";

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
