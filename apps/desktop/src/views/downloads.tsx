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
import { defaultAppConfig } from "../core/appConfig";
import { downloadFormats } from "../core/types";
import { defaultFilters, defaultSelection, estimateChapters, selectionLabel } from "../services/mockBackend";
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
} from "../core/types";
import { runWindowAction } from "../core/windowControls";
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
              <button className="select-all-button" title={allSelected ? "Limpar selecao" : "Selecionar todos"} aria-label="Selecionar todos" onClick={onToggleSelectAll} disabled={completed.length === 0}>
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
                <RefreshCcw size={15} />
                Converter
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
