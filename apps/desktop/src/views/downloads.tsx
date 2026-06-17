import {
  FolderOpen,
  Headphones,
  Languages,
  Pause,
  Play,
  Trash2
} from "lucide-react";
import type { QueueItem } from "../core/types";

export function DownloadsView({
  queue,
  paused,
  onPauseToggle,
  onClearCompleted,
  onCancel,
  onOpenItemFolder
}: {
  queue: QueueItem[];
  paused: boolean;
  onPauseToggle: () => void;
  onClearCompleted: () => void;
  onCancel: (id: string) => void;
  onOpenItemFolder: (item: QueueItem) => void;
}) {
  const pending = queue.filter((item) => item.state !== "done");
  const completed = queue.filter((item) => item.state === "done");

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
              <span>{completed.length} item(ns)</span>
            </div>
            <div className="pane-actions">
              <button className="button quiet compact" onClick={onClearCompleted} disabled={completed.length === 0}>
                <Trash2 size={15} />
                Limpar
              </button>
            </div>
          </div>
          <div className="download-table">
            {completed.length === 0 ? (
              <div className="empty-state compact">Nenhum download concluido.</div>
            ) : (
              completed.map((item) => {
                return (
                  <article
                    className="download-row complete"
                    key={item.id}
                  >
                    <div
                      className={`queue-thumb ${item.coverClass}`}
                      style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                    />
                    <div className="download-info">
                      <strong>{item.title}</strong>
                      <small>{item.rangeLabel}</small>
                      <div className="queue-badges">
                        {item.formats.map((format) => (
                          <span className="badge" key={format} title={item.outputFiles?.filter((file) => file.toLowerCase().endsWith(`.${format.toLowerCase()}`)).join(", ") || format}>{format}</span>
                        ))}
                        {item.translate ? <span className="badge accent"><Languages size={11} /> Traduzir</span> : null}
                        {item.audiobook ? <span className="badge accent"><Headphones size={11} /> Audiobook</span> : null}
                      </div>
                    </div>
                    <button
                      className="icon-button small row-folder"
                      title="Abrir pasta deste livro"
                      aria-label={`Abrir pasta de ${item.title}`}
                      onClick={() => onOpenItemFolder(item)}
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
