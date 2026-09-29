import { FolderOpen, Settings } from "lucide-react";
import { useState } from "react";
import { indexModeOptions } from "../constants/ui";
import type { AppConfig, IndexMode } from "../core/types";
import { downloadFormats } from "../core/types";
import { isTauriRuntime } from "../core/windowControls";
import { pickDirectory } from "../services/localFiles";
import { settingsStrings } from "../strings/settings";

/**
 * "Escolher…" button that opens the native folder picker (Tauri only; hidden in the
 * browser, where there is no picker). Calls `onPick` with the chosen absolute path.
 */
export function FolderPickButton({ value, onPick }: { value: string; onPick: (path: string) => void }) {
  const [busy, setBusy] = useState(false);
  if (!isTauriRuntime()) return null;
  const pick = () => {
    setBusy(true);
    void pickDirectory({ defaultPath: value || undefined, title: settingsStrings.pickOutputFolderTitle })
      .then((path) => {
        if (path) onPick(path);
      })
      .finally(() => setBusy(false));
  };
  return (
    <button type="button" className="button quiet" data-testid="pick-output-folder" onClick={pick} disabled={busy}>
      <FolderOpen size={15} />
      {settingsStrings.pickOutputFolder}
    </button>
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
      <div className="settings-grid">
        <article className="settings-panel">
          <h3>Servidor</h3>
          <div className="field-group">
            <label>API local</label>
            <input value={config.serverUrl} onChange={(event) => onConfigChange({ serverUrl: event.target.value })} />
          </div>
          <div className="field-group">
            <label htmlFor="settings-output-path">{settingsStrings.outputPath}</label>
            <input id="settings-output-path" value={config.outputPath} onChange={(event) => onConfigChange({ outputPath: event.target.value })} />
            <FolderPickButton value={config.outputPath} onPick={(outputPath) => onConfigChange({ outputPath })} />
          </div>
          <div className="field-group">
            <label htmlFor="settings-index-mode">Modo de indexacao</label>
            <select id="settings-index-mode" value={config.indexMode} onChange={(event) => onConfigChange({ indexMode: event.target.value as IndexMode })}>
              {indexModeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
          <button className="button quiet" onClick={onOpenOnboarding}>
            <Settings size={15} />
            Assistente inicial
          </button>
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
