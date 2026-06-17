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

export function OnboardingWizard({
  open,
  allowClose,
  step,
  config,
  sources,
  serverProbe,
  probingServer,
  setupSync,
  setupSyncRunning,
  setupSyncCompleted,
  onChange,
  onToggleSource,
  onValidateServer,
  onBack,
  onNext,
  onClose
}: {
  open: boolean;
  allowClose: boolean;
  step: number;
  config: AppConfig;
  sources: SourceSite[];
  serverProbe: ServerProbe | null;
  probingServer: boolean;
  setupSync: Record<string, SetupSyncEntry>;
  setupSyncRunning: boolean;
  setupSyncCompleted: boolean;
  onChange: (patch: Partial<AppConfig>) => void;
  onToggleSource: (sourceId: string) => void;
  onValidateServer: () => void;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const selectedSources = sources.filter((source) => config.enabledSourceIds.includes(source.id));
  const isLastStep = step === onboardingSteps.length - 1;
  const summaryStep = onboardingSteps.length - 2;
  const overallProgress = selectedSources.length === 0
    ? 0
    : Math.round(selectedSources.reduce((total, source) => total + (setupSync[source.id]?.progress ?? 0), 0) / selectedSources.length);
  const canProceed = (() => {
    if (step === 1) return Boolean(serverProbe && serverProbe.serverUrl === config.serverUrl);
    if (step === 2) return config.outputPath.trim().length > 0;
    if (step === 3) return selectedSources.length > 0;
    if (step === onboardingSteps.length - 1) return setupSyncCompleted;
    return true;
  })();

  return (
    <div className="setup-backdrop">
      <section className="setup-panel" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <div className="setup-header">
          <div>
            <span className="setup-eyebrow">Configuracao inicial</span>
            <h1 id="setup-title">{onboardingSteps[step]}</h1>
          </div>
          {allowClose ? (
            <button className="icon-button small" aria-label="Fechar assistente" onClick={onClose}>
              <X size={15} />
            </button>
          ) : null}
        </div>

        <div className="setup-stepper" aria-label="Etapas da configuracao">
          {onboardingSteps.map((label, index) => (
            <div className={`setup-step ${index === step ? "active" : ""} ${index < step ? "done" : ""}`} key={label}>
              <span>{index < step ? <Check size={12} /> : index + 1}</span>
              <strong>{label}</strong>
            </div>
          ))}
        </div>

        {step === 0 ? (
          <div className="setup-content">
            <div className="setup-hero">
              <div>
                <h2>Bem-vindo ao Oghma Library</h2>
                <p>Vamos preparar o ambiente inicial para indexar fontes, definir a pasta de saida e deixar o fluxo pronto para downloads, EPUB e etapas futuras como traducao e audiobook.</p>
              </div>
              <div className="setup-grid three">
                <article className="setup-info-card">
                  <strong>Servidor de index</strong>
                  <p>Conecta ao node que mantem catalogo, fontes suportadas e estado de sincronizacao.</p>
                </article>
                <article className="setup-info-card">
                  <strong>Saida local</strong>
                  <p>Escolhe a pasta onde os livros exportados, caches e conversoes vao morar.</p>
                </article>
                <article className="setup-info-card">
                  <strong>Preferencias padrao</strong>
                  <p>Define formatos, motor de IA e comportamento de sincronizacao para o primeiro uso.</p>
                </article>
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Servidor e modo de indexacao</h2>
              <p>Este servidor entrega o catalogo inicial e a lista de fontes disponiveis para preservacao.</p>
            </div>
            <div className="field-group">
              <label htmlFor="setup-server-url">Servidor de index</label>
              <input
                id="setup-server-url"
                value={config.serverUrl}
                onChange={(event) => onChange({ serverUrl: event.target.value })}
                placeholder="http://192.168.0.42:8000"
              />
            </div>
            <div className="field-group">
              <label>Modo de indexacao</label>
              <div className="setup-choice-grid">
                {indexModeOptions.map((option) => (
                  <button
                    key={option.value}
                    className={`setup-choice ${config.indexMode === option.value ? "active" : ""}`}
                    aria-pressed={config.indexMode === option.value}
                    onClick={() => onChange({ indexMode: option.value })}
                  >
                    <strong>{option.label}</strong>
                    <span>{option.description}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="setup-inline-actions">
              <button className="button primary" onClick={onValidateServer} disabled={probingServer || config.serverUrl.trim().length === 0}>
                {probingServer ? <Loader2 className="spin" size={15} /> : <Globe2 size={15} />}
                {probingServer ? "Validando..." : "Verificar servidor"}
              </button>
            </div>
            {serverProbe && serverProbe.serverUrl === config.serverUrl ? (
              <div className="setup-status-card">
                <div className="setup-status-title">
                  <CheckCircle2 size={16} />
                  <strong>{serverProbe.serverName}</strong>
                </div>
                <div className="setup-grid three">
                  <div><span>Versao</span><strong>{serverProbe.version}</strong></div>
                  <div><span>Latencia</span><strong>{serverProbe.latencyMs} ms</strong></div>
                  <div><span>Fontes</span><strong>{serverProbe.sourceCount} disponiveis</strong></div>
                </div>
                <small>Storage informado pelo servidor: {serverProbe.storageRoot}</small>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 2 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Pasta de saida</h2>
              <p>Use uma pasta previsivel para EPUBs, PDFs, conversoes para Kindle e artefatos auxiliares.</p>
            </div>
            <div className="field-group">
              <label htmlFor="setup-output">Pasta local de saida</label>
              <input
                id="setup-output"
                value={config.outputPath}
                onChange={(event) => onChange({ outputPath: event.target.value })}
                placeholder="~/Documents/Oghma Library/exports"
              />
            </div>
            <div className="setup-inline-actions">
              <button className="button quiet" onClick={() => onChange({ outputPath: defaultAppConfig().outputPath })}>
                <FolderOpen size={15} />
                Usar pasta padrao
              </button>
            </div>
            <div className="setup-info-strip">
              <strong>Padrao sugerido</strong>
              <span>{defaultAppConfig().outputPath}</span>
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Selecione as fontes para indexar</h2>
              <p>A lista abaixo foi entregue pelo servidor configurado. Voce pode ativar so o que realmente quer preservar agora.</p>
            </div>
            <div className="setup-source-grid">
              {sources.map((source) => {
                const active = config.enabledSourceIds.includes(source.id);
                return (
                  <button
                    key={source.id}
                    className={`setup-source-card ${active ? "active" : ""}`}
                    aria-pressed={active}
                    onClick={() => onToggleSource(source.id)}
                  >
                    <div className="setup-source-head">
                      <span className={`status-dot ${source.status}`} />
                      <strong>{source.name}</strong>
                    </div>
                    <p>{source.baseUrl}</p>
                    <div className="setup-source-meta">
                      <span>{source.mode}</span>
                      <span>{source.count.toLocaleString("pt-BR")} novels</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Preferencias iniciais</h2>
              <p>Esses valores entram como padrao nos downloads e servem como base para as features futuras do backend.</p>
            </div>
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
                      onChange({
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
            <div className="field-grid two">
              <div className="field-group">
                <label htmlFor="setup-translation-engine">Motor de IA padrao</label>
                <select
                  id="setup-translation-engine"
                  value={config.translationEngine}
                  onChange={(event) => onChange({ translationEngine: event.target.value as TranslationEngine })}
                >
                  {translationEngineOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="setup-language">Idioma de destino</label>
                <select id="setup-language" value={config.targetLanguage} onChange={(event) => onChange({ targetLanguage: event.target.value })}>
                  <option value="PT-BR">Portugues (BR)</option>
                  <option value="EN">Ingles</option>
                  <option value="ES">Espanhol</option>
                </select>
              </div>
            </div>
            <label className="toggle-line">
              <input type="checkbox" checked={config.translateDefault} onChange={(event) => onChange({ translateDefault: event.target.checked })} />
              <span className="toggle" />
              <span>Traduzir por padrao</span>
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={config.audiobookDefault} onChange={(event) => onChange({ audiobookDefault: event.target.checked })} />
              <span className="toggle" />
              <span>Gerar audiobook por padrao</span>
            </label>
            <label className="toggle-line">
              <input type="checkbox" checked={config.syncOnLaunch} onChange={(event) => onChange({ syncOnLaunch: event.target.checked })} />
              <span className="toggle" />
              <span>Sincronizar indices ao abrir o app</span>
            </label>
          </div>
        ) : null}

        {step === 5 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Resumo da configuracao</h2>
              <p>Se estiver tudo certo, seguimos para a sincronizacao inicial dos indices das fontes selecionadas.</p>
            </div>
            <div className="setup-summary">
              <div><span>Servidor</span><strong>{config.serverUrl}</strong></div>
              <div><span>Modo de indexacao</span><strong>{indexModeOptions.find((option) => option.value === config.indexMode)?.label}</strong></div>
              <div><span>Pasta de saida</span><strong>{config.outputPath}</strong></div>
              <div><span>Fontes ativas</span><strong>{selectedSources.map((source) => source.name).join(", ")}</strong></div>
              <div><span>Formatos padrao</span><strong>{config.defaultFormats.join(", ")}</strong></div>
              <div><span>Motor de IA</span><strong>{translationEngineOptions.find((option) => option.value === config.translationEngine)?.label}</strong></div>
            </div>
          </div>
        ) : null}

        {step === 6 ? (
          <div className="setup-content">
            <div className="setup-copy">
              <h2>Sincronizacao inicial dos indices</h2>
              <p>Agora o app esta baixando os indices e metadados basicos das fontes selecionadas para deixar a busca pronta no primeiro uso.</p>
            </div>
            <div className="setup-status-card">
              <div className="setup-status-title">
                <strong>{setupSyncCompleted ? "Sincronizacao concluida" : setupSyncRunning ? "Baixando indices das fontes" : "Preparando sincronizacao"}</strong>
                <span>{overallProgress}%</span>
              </div>
              <div className="progress"><span style={{ width: `${overallProgress}%` }} /></div>
            </div>
            <div className="setup-sync-list">
              {selectedSources.map((source) => {
                const state = setupSync[source.id] ?? { progress: 0, status: "pending", detail: "Aguardando..." };
                const statusLabelText = state.status === "done"
                  ? "Pronto"
                  : state.status === "syncing"
                    ? "Baixando"
                    : state.status === "error"
                      ? "Falhou"
                      : "Aguardando";
                return (
                  <article className="setup-sync-row" key={source.id}>
                    <div className="setup-sync-meta">
                      <div>
                        <strong>{source.name}</strong>
                        <small>{state.detail}</small>
                      </div>
                      <span className={`setup-sync-badge ${state.status}`}>{statusLabelText}</span>
                    </div>
                    <div className="progress thin"><span style={{ width: `${state.progress}%` }} /></div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="setup-footer">
          <button className="button quiet" onClick={onBack} disabled={step === 0 || setupSyncRunning}>
            Voltar
          </button>
          <button className="button primary" onClick={onNext} disabled={!canProceed}>
            {isLastStep ? "Entrar no app" : step === summaryStep ? "Concluir e baixar indices" : "Proximo"}
          </button>
        </div>
      </section>
    </div>
  );
}
