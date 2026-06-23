import {
  BookOpen,
  Calculator,
  Check,
  CircleDollarSign,
  FolderOpen,
  Languages,
  ListPlus,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { translationEngineOptions } from "../constants/ui";
import type { AppConfig, DownloadFormat, LibraryItem } from "../core/types";

type TranslationScope = "pilot" | "range" | "all";
type TranslationQuality = "conservative" | "balanced" | "literary";
type SessionStatus = "ready" | "waiting";

type TranslationSessionItem = {
  id: string;
  title: string;
  chapters: number;
  scopeLabel: string;
  qualityLabel: string;
  model: string;
  estimatedBRL: number;
  estimatedTokens: number;
  status: SessionStatus;
};

type GlossaryTerm = {
  id: string;
  source: string;
  target: string;
  note: string;
};

const formatOptions: Array<DownloadFormat | "all"> = ["all", "EPUB", "PDF", "TXT", "AZW3"];

const qualityOptions: Array<{
  value: TranslationQuality;
  label: string;
  detail: string;
  inputTokensPerChapter: number;
  outputTokensPerChapter: number;
}> = [
  {
    value: "conservative",
    label: "Conservador",
    detail: "Consistencia de nomes e menos reescrita.",
    inputTokensPerChapter: 2600,
    outputTokensPerChapter: 3100
  },
  {
    value: "balanced",
    label: "Balanceado",
    detail: "Traducao, revisao curta e QA automatico.",
    inputTokensPerChapter: 3600,
    outputTokensPerChapter: 4300
  },
  {
    value: "literary",
    label: "Literario",
    detail: "Mais contexto, revisao e reparo terminologico.",
    inputTokensPerChapter: 5200,
    outputTokensPerChapter: 6200
  }
];

const modelOptionsByEngine: Record<AppConfig["translationEngine"], string[]> = {
  openai: ["gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano"],
  local: ["local-quality", "local-balanced"],
  deepl: ["deepl-write", "deepl-default"],
  google: ["google-translate"]
};

const initialGlossaryTerms: GlossaryTerm[] = [
  {
    id: "term-gu-master",
    source: "Gu Master",
    target: "Mestre Gu",
    note: "Manter Gu como termo proprio."
  },
  {
    id: "term-primeval-essence",
    source: "primeval essence",
    target: "essencia primeva",
    note: "Usar a mesma forma em todos os capitulos."
  }
];

const currencyBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const currencyUSD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function parseDecimal(value: string) {
  const normalized = value.replace(",", ".");
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function formatsFor(item: LibraryItem) {
  return item.formats?.length ? item.formats : [item.format];
}

function hasFormat(item: LibraryItem, format: DownloadFormat | "all") {
  if (format === "all") return true;
  return formatsFor(item).includes(format);
}

function clampChapter(value: number, max: number) {
  return Math.max(1, Math.min(max, Number.isFinite(value) ? value : 1));
}

export function TranslationView({
  library,
  config,
  onConfigChange,
  onOpenItemFolder,
  onNotify
}: {
  library: LibraryItem[];
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onOpenItemFolder: (item: LibraryItem) => void;
  onNotify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [format, setFormat] = useState<DownloadFormat | "all">("all");
  const [selectedId, setSelectedId] = useState<string>("");
  const [scope, setScope] = useState<TranslationScope>("pilot");
  const [rangeStart, setRangeStart] = useState(1);
  const [rangeEnd, setRangeEnd] = useState(5);
  const [quality, setQuality] = useState<TranslationQuality>("literary");
  const [model, setModel] = useState(modelOptionsByEngine[config.translationEngine][0]);
  const [inputUsdPerMillion, setInputUsdPerMillion] = useState("0.00");
  const [outputUsdPerMillion, setOutputUsdPerMillion] = useState("0.00");
  const [usdBrl, setUsdBrl] = useState("5.50");
  const [sessionItems, setSessionItems] = useState<TranslationSessionItem[]>([]);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>(initialGlossaryTerms);
  const [termSource, setTermSource] = useState("");
  const [termTarget, setTermTarget] = useState("");

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

  useEffect(() => {
    if (library.length === 0) {
      setSelectedId("");
      return;
    }
    if (!library.some((item) => item.id === selectedId)) {
      setSelectedId(library[0].id);
    }
  }, [library, selectedId]);

  const selectedItem = library.find((item) => item.id === selectedId) ?? null;
  const modelOptions = modelOptionsByEngine[config.translationEngine];
  const qualityProfile = qualityOptions.find((item) => item.value === quality) ?? qualityOptions[0];
  const selectedChapterCount = Math.max(1, selectedItem?.chapters || 1);
  const clampedStart = clampChapter(rangeStart, selectedChapterCount);
  const clampedEnd = Math.max(clampedStart, clampChapter(rangeEnd, selectedChapterCount));
  const pilotEnd = Math.min(5, selectedChapterCount);
  const scopeChapters = scope === "all"
    ? selectedChapterCount
    : scope === "pilot"
    ? pilotEnd
    : clampedEnd - clampedStart + 1;
  const scopeLabel = scope === "all"
    ? `Todos os ${selectedChapterCount.toLocaleString("pt-BR")} capitulos`
    : scope === "pilot"
    ? `Piloto 1-${pilotEnd}`
    : `Capitulos ${clampedStart}-${clampedEnd}`;
  const estimatedInputTokens = scopeChapters * qualityProfile.inputTokensPerChapter;
  const estimatedOutputTokens = scopeChapters * qualityProfile.outputTokensPerChapter;
  const estimatedTokens = estimatedInputTokens + estimatedOutputTokens;
  const estimatedUSD = (estimatedInputTokens / 1_000_000) * parseDecimal(inputUsdPerMillion)
    + (estimatedOutputTokens / 1_000_000) * parseDecimal(outputUsdPerMillion);
  const estimatedBRL = estimatedUSD * parseDecimal(usdBrl);
  const sessionEstimatedBRL = sessionItems.reduce((total, item) => total + item.estimatedBRL, 0);
  const sessionTokens = sessionItems.reduce((total, item) => total + item.estimatedTokens, 0);
  const sessionChapters = sessionItems.reduce((total, item) => total + item.chapters, 0);

  useEffect(() => {
    if (!modelOptions.includes(model)) {
      setModel(modelOptions[0]);
    }
  }, [model, modelOptions]);

  useEffect(() => {
    if (!selectedItem) return;
    const nextEnd = Math.min(5, Math.max(1, selectedItem.chapters || 1));
    setRangeStart(1);
    setRangeEnd(nextEnd);
    setScope("pilot");
  }, [selectedItem?.id]);

  const addSessionItem = () => {
    if (!selectedItem) return;
    const entry: TranslationSessionItem = {
      id: `${selectedItem.id}-${Date.now()}`,
      title: selectedItem.title,
      chapters: scopeChapters,
      scopeLabel,
      qualityLabel: qualityProfile.label,
      model,
      estimatedBRL,
      estimatedTokens,
      status: "ready"
    };
    setSessionItems((items) => [entry, ...items]);
    onNotify(`Lote de traducao preparado para ${selectedItem.title}.`);
  };

  const startSession = () => {
    if (sessionItems.length === 0) return;
    setSessionItems((items) => items.map((item) => ({ ...item, status: "waiting" })));
    onNotify("Sessao preparada. A execucao sera ligada ao pipeline de traducao.");
  };

  const addGlossaryTerm = () => {
    const source = termSource.trim();
    const target = termTarget.trim();
    if (!source || !target) return;
    setGlossaryTerms((items) => [
      { id: `${source}-${Date.now()}`, source, target, note: "Adicionado na central de traducao." },
      ...items
    ]);
    setTermSource("");
    setTermTarget("");
  };

  return (
    <section className="translation-workspace full-span">
      <aside className="filter-panel translation-library-panel">
        <div className="panel-header">
          <div>
            <h2>Projetos</h2>
            <span>Biblioteca local</span>
          </div>
          <Languages size={18} />
        </div>
        <div className="field-group">
          <label htmlFor="translation-query">Busca</label>
          <div className="input-with-icon">
            <Search size={16} />
            <input id="translation-query" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>
        <div className="field-group">
          <label htmlFor="translation-format">Formato local</label>
          <select id="translation-format" value={format} onChange={(event) => setFormat(event.target.value as DownloadFormat | "all")}>
            {formatOptions.map((option) => (
              <option value={option} key={option}>{option === "all" ? "Todos" : option}</option>
            ))}
          </select>
        </div>
        <div className="active-filter-row translation-filter-row">
          <span>{filtered.length} de {library.length} livros</span>
          {query || format !== "all" ? (
            <button onClick={() => {
              setQuery("");
              setFormat("all");
            }}>
              Limpar
            </button>
          ) : null}
        </div>
        <div className="translation-book-list">
          {filtered.length === 0 ? (
            <div className="empty-state compact">
              <BookOpen size={18} />
              <span>Nenhum livro local encontrado.</span>
            </div>
          ) : filtered.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                className={`translation-book-row ${selected ? "selected" : ""}`}
                key={item.id}
                onClick={() => setSelectedId(item.id)}
                aria-pressed={selected}
              >
                <span
                  className={`queue-thumb ${item.coverClass}`}
                  style={item.coverUrl ? { backgroundImage: `url("${item.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                />
                <span className="translation-book-copy">
                  <strong>{item.title}</strong>
                  <small>{item.chapters ? `${item.chapters.toLocaleString("pt-BR")} capitulos` : `${item.sizeMb} MB locais`}</small>
                </span>
                {selected ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      </aside>

      <section className="translation-main-panel">
        <div className="toolbar translation-toolbar">
          <div>
            <h2>Sessao de traducao</h2>
            <span>{selectedItem ? selectedItem.title : "Selecione uma obra local"}</span>
          </div>
          <div className="toolbar-actions">
            <button className="button quiet" onClick={() => selectedItem ? onOpenItemFolder(selectedItem) : undefined} disabled={!selectedItem}>
              <FolderOpen size={15} />
              Pasta
            </button>
            <button className="button primary" onClick={addSessionItem} disabled={!selectedItem}>
              <ListPlus size={15} />
              Adicionar lote
            </button>
          </div>
        </div>

        <div className="translation-metrics-grid">
          <article className="translation-metric">
            <span>Estimativa da sessao</span>
            <strong>{currencyBRL.format(sessionEstimatedBRL)}</strong>
          </article>
          <article className="translation-metric">
            <span>Uso real registrado</span>
            <strong>{currencyBRL.format(0)}</strong>
          </article>
          <article className="translation-metric">
            <span>Capitulos no lote</span>
            <strong>{sessionChapters.toLocaleString("pt-BR")}</strong>
          </article>
          <article className="translation-metric">
            <span>Tokens estimados</span>
            <strong>{sessionTokens.toLocaleString("pt-BR")}</strong>
          </article>
        </div>

        <div className="translation-control-grid">
          <article className="settings-panel translation-panel">
            <div className="translation-panel-title">
              <SlidersHorizontal size={16} />
              <h3>Escopo</h3>
            </div>
            <div className="segmented presets">
              {([
                ["pilot", "Piloto"],
                ["range", "Faixa"],
                ["all", "Tudo"]
              ] as const).map(([value, label]) => (
                <button key={value} className={scope === value ? "active" : ""} onClick={() => setScope(value)}>
                  {label}
                </button>
              ))}
            </div>
            {scope === "range" ? (
              <div className="chapter-range">
                <label>
                  Inicio
                  <input
                    type="number"
                    min={1}
                    max={clampedEnd}
                    value={rangeStart}
                    onChange={(event) => setRangeStart(clampChapter(Number(event.target.value), selectedChapterCount))}
                  />
                </label>
                <label>
                  Fim
                  <input
                    type="number"
                    min={clampedStart}
                    max={selectedChapterCount}
                    value={rangeEnd}
                    onChange={(event) => setRangeEnd(clampChapter(Number(event.target.value), selectedChapterCount))}
                  />
                </label>
              </div>
            ) : null}
            <div className="translation-estimate-strip">
              <Calculator size={15} />
              <span>{scopeLabel} - {currencyBRL.format(estimatedBRL)} estimado</span>
            </div>
          </article>

          <article className="settings-panel translation-panel">
            <div className="translation-panel-title">
              <Sparkles size={16} />
              <h3>Qualidade</h3>
            </div>
            <div className="translation-quality-list">
              {qualityOptions.map((option) => (
                <button
                  className={`translation-quality-option ${quality === option.value ? "active" : ""}`}
                  key={option.value}
                  onClick={() => setQuality(option.value)}
                  aria-pressed={quality === option.value}
                >
                  <strong>{option.label}</strong>
                  <span>{option.detail}</span>
                </button>
              ))}
            </div>
          </article>

          <article className="settings-panel translation-panel">
            <div className="translation-panel-title">
              <CircleDollarSign size={16} />
              <h3>Modelo e custo</h3>
            </div>
            <div className="field-grid two">
              <div className="field-group">
                <label htmlFor="translation-engine">Provedor</label>
                <select
                  id="translation-engine"
                  value={config.translationEngine}
                  onChange={(event) => onConfigChange({ translationEngine: event.target.value as AppConfig["translationEngine"] })}
                >
                  {translationEngineOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="translation-model">Modelo</label>
                <select id="translation-model" value={model} onChange={(event) => setModel(event.target.value)}>
                  {modelOptions.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field-grid two">
              <div className="field-group">
                <label htmlFor="translation-target-language">Idioma</label>
                <select id="translation-target-language" value={config.targetLanguage} onChange={(event) => onConfigChange({ targetLanguage: event.target.value })}>
                  <option value="PT-BR">Portugues (BR)</option>
                  <option value="EN">Ingles</option>
                  <option value="ES">Espanhol</option>
                </select>
              </div>
              <div className="field-group">
                <label htmlFor="translation-usd-brl">Dolar BRL</label>
                <input id="translation-usd-brl" inputMode="decimal" value={usdBrl} onChange={(event) => setUsdBrl(event.target.value)} />
              </div>
            </div>
            <div className="field-grid two">
              <div className="field-group">
                <label htmlFor="translation-input-price">Entrada USD/1M</label>
                <input id="translation-input-price" inputMode="decimal" value={inputUsdPerMillion} onChange={(event) => setInputUsdPerMillion(event.target.value)} />
              </div>
              <div className="field-group">
                <label htmlFor="translation-output-price">Saida USD/1M</label>
                <input id="translation-output-price" inputMode="decimal" value={outputUsdPerMillion} onChange={(event) => setOutputUsdPerMillion(event.target.value)} />
              </div>
            </div>
            <div className="translation-cost-line">
              <span>{currencyUSD.format(estimatedUSD)}</span>
              <strong>{currencyBRL.format(estimatedBRL)}</strong>
            </div>
          </article>
        </div>

        <section className="translation-session-panel">
          <div className="pane-header">
            <div>
              <h3>Lotes preparados</h3>
              <span>{sessionItems.length} item(ns)</span>
            </div>
            <button className="button primary" onClick={startSession} disabled={sessionItems.length === 0}>
              <Play size={15} />
              Preparar execucao
            </button>
          </div>
          <div className="translation-session-list">
            {sessionItems.length === 0 ? (
              <div className="empty-state compact">Nenhum lote preparado.</div>
            ) : sessionItems.map((item) => (
              <article className={`translation-session-row ${item.status}`} key={item.id}>
                <div className="translation-session-main">
                  <strong>{item.title}</strong>
                  <span>{item.scopeLabel} - {item.qualityLabel} - {item.model}</span>
                </div>
                <div className="translation-session-numbers">
                  <strong>{currencyBRL.format(item.estimatedBRL)}</strong>
                  <span>{item.chapters.toLocaleString("pt-BR")} cap. - {item.estimatedTokens.toLocaleString("pt-BR")} tokens</span>
                </div>
                <button
                  className="toolbar-control"
                  title="Remover lote"
                  aria-label={`Remover lote de ${item.title}`}
                  onClick={() => setSessionItems((items) => items.filter((entry) => entry.id !== item.id))}
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
          </div>
        </section>
      </section>

      <aside className="library-detail-panel translation-side-panel">
        <div className="library-detail-heading">
          <div>
            <h3>Glossario</h3>
            <span>{glossaryTerms.length} termo(s) ativos</span>
          </div>
        </div>
        <div className="translation-glossary-editor">
          <div className="field-grid two">
            <div className="field-group">
              <label htmlFor="glossary-source">Termo original</label>
              <input id="glossary-source" value={termSource} onChange={(event) => setTermSource(event.target.value)} />
            </div>
            <div className="field-group">
              <label htmlFor="glossary-target">Traducao fixa</label>
              <input id="glossary-target" value={termTarget} onChange={(event) => setTermTarget(event.target.value)} />
            </div>
          </div>
          <button className="button quiet" onClick={addGlossaryTerm} disabled={!termSource.trim() || !termTarget.trim()}>
            <Plus size={14} />
            Adicionar termo
          </button>
        </div>
        <div className="translation-glossary-list">
          {glossaryTerms.map((term) => (
            <article className="translation-glossary-row" key={term.id}>
              <div>
                <strong>{term.source}</strong>
                <span>{term.target}</span>
              </div>
              <small>{term.note}</small>
              <button
                className="toolbar-control"
                title="Remover termo"
                aria-label={`Remover termo ${term.source}`}
                onClick={() => setGlossaryTerms((items) => items.filter((item) => item.id !== term.id))}
              >
                <Trash2 size={14} />
              </button>
            </article>
          ))}
        </div>
      </aside>
    </section>
  );
}
