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
