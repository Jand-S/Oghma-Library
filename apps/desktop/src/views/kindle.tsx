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

export function ConversionModal({
  open,
  items,
  formats,
  translate,
  audiobook,
  progress,
  running,
  onToggleFormat,
  onToggleTranslate,
  onToggleAudiobook,
  onClose,
  onStart
}: {
  open: boolean;
  items: QueueItem[];
  formats: Set<DownloadFormat>;
  translate: boolean;
  audiobook: boolean;
  progress: number;
  running: boolean;
  onToggleFormat: (format: DownloadFormat) => void;
  onToggleTranslate: () => void;
  onToggleAudiobook: () => void;
  onClose: () => void;
  onStart: () => void;
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="conversion-modal-title">
        <div className="modal-header">
          <div>
            <h2 id="conversion-modal-title">Converter downloads</h2>
            <span>{items.length} livro(s) selecionado(s)</span>
          </div>
          <button className="icon-button small" aria-label="Fechar modal" onClick={onClose} disabled={running}>
            <X size={15} />
          </button>
        </div>
        <div className="modal-body">
          <p>Formatos ja existentes serao ignorados. O app so gera o que estiver faltando na pasta de cada livro.</p>
          <div className="format-options">
            {downloadFormats.map((format) => (
              <button
                key={format}
                className={`format-chip ${formats.has(format) ? "active" : ""}`}
                aria-pressed={formats.has(format)}
                onClick={() => onToggleFormat(format)}
                disabled={running}
              >
                {format}
              </button>
            ))}
          </div>
          <div className="modal-list">
            {items.map((item) => (
              <span className="badge" key={item.id}>{item.title}</span>
            ))}
          </div>
          <div className="format-options">
            <button className={`format-chip ${translate ? "active" : ""}`} onClick={onToggleTranslate} disabled={running}>
              <Languages size={13} />
              Traduzir
            </button>
            <button className={`format-chip ${audiobook ? "active" : ""}`} onClick={onToggleAudiobook} disabled={running}>
              <Headphones size={13} />
              Audiobook
            </button>
          </div>
          <div className="kindle-progress-block">
            <div className="kindle-progress-header">
              <strong>{running ? "Convertendo" : "Pronto para converter"}</strong>
              <span>{Math.round(progress)}%</span>
            </div>
            <div className="progress"><span style={{ width: `${progress}%` }} /></div>
          </div>
        </div>
        <div className="modal-actions">
          <button className="button quiet" onClick={onClose} disabled={running}>Cancelar</button>
          <button className="button primary" onClick={onStart} disabled={running || items.length === 0}>
            {running ? "Convertendo..." : "Converter"}
          </button>
        </div>
      </div>
    </div>
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
