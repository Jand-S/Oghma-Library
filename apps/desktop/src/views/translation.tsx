import {
  BookOpen,
  Calculator,
  Check,
  CircleDollarSign,
  FolderOpen,
  Languages,
  ListPlus,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { translationEngineOptions } from "../constants/ui";
import type {
  AppConfig,
  DownloadFormat,
  LibraryItem,
  TranslationAutomaticPlan,
  TranslationCoverage,
  TranslationEstimate,
  TranslationEstimateMode,
  TranslationJob,
  TranslationMemoryConflict,
  TranslationMemoryConflictSuggestion,
  TranslationMemoryTerm,
  TranslationSelectionRecord
} from "../core/types";
import { getErrorMessage, type BackendClient } from "../services/backendClient";

type TranslationScope = "pilot" | "range" | "all";
type TranslationQuality = "conservative" | "balanced" | "literary";
type SessionStatus = "ready" | "waiting" | "translating" | "paused" | "done" | "failed" | "cancelled";

type TranslationSessionItem = {
  id: string;
  novelId: string;
  title: string;
  chapters: number;
  chapterFrom: number;
  chapterTo: number;
  scopeLabel: string;
  qualityLabel: string;
  mode: TranslationEstimateMode;
  model: string;
  provider: string;
  workerCount: number;
  estimatedBRL: number;
  estimatedTokens: number;
  sourceChars?: number;
  status: SessionStatus;
  jobId?: string;
  progressPercent?: number;
  actualCostBRL?: number | null;
  actualCostUSD?: number;
  estimatedRemainingBRL?: number | null;
  etaSeconds?: number | null;
  averageSecondsPerChapter?: number;
  retryCount?: number;
  repairCount?: number;
  retryRatePercent?: number;
  repairRatePercent?: number;
  providerStabilityPercent?: number;
  costPerMinuteUSD?: number;
  failedCount?: number;
  effectiveWorkerCount?: number;
  telemetryReason?: string;
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
  openai: ["gpt-5.4-mini", "gpt-4.1-mini", "gpt-5.4-nano"],
  local: ["local-quality", "local-balanced"],
  deepl: ["deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"],
  google: ["google/gemini-3-flash-preview", "google/gemini-3.1-flash-lite"]
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

function plannerMode(quality: TranslationQuality): TranslationEstimateMode {
  if (quality === "conservative") return "economy";
  if (quality === "literary") return "quality";
  return "balanced";
}

function durationLabel(seconds: number | null | undefined) {
  if (!seconds) return "sem historico";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function coverageRangeLabel(ranges: TranslationCoverage["ranges"]) {
  if (ranges.length === 0) return "sem faixas";
  const shown = ranges.slice(0, 3).map((range) => range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`);
  return ranges.length > shown.length ? `${shown.join(", ")} +${ranges.length - shown.length}` : shown.join(", ");
}

function providerForModel(model: string, engine: AppConfig["translationEngine"]) {
  if (model.startsWith("google/") || model.startsWith("deepseek/") || model.startsWith("anthropic/")) return "openrouter";
  if (model.startsWith("gpt-")) return "openai";
  if (engine === "local") return "fake";
  return engine;
}

function sessionStatusFromJob(job: TranslationJob): SessionStatus {
  if (job.status === "translating" || job.status === "paused" || job.status === "done" || job.status === "failed" || job.status === "cancelled") {
    return job.status;
  }
  return "waiting";
}

function patchSessionFromJob(item: TranslationSessionItem, job: TranslationJob): TranslationSessionItem {
  return {
    ...item,
    jobId: job.id,
    status: sessionStatusFromJob(job),
    progressPercent: job.stats.progressPercent,
    actualCostUSD: job.stats.actualCostUsd,
    actualCostBRL: job.stats.actualCostBrl,
    estimatedRemainingBRL: job.stats.estimatedRemainingCostBrl,
    etaSeconds: job.stats.etaSeconds,
    averageSecondsPerChapter: job.stats.averageSecondsPerChapter,
    retryCount: job.stats.retryCount,
    repairCount: job.stats.repairCount,
    retryRatePercent: job.stats.retryRatePercent,
    repairRatePercent: job.stats.repairRatePercent,
    providerStabilityPercent: job.stats.providerStabilityPercent,
    costPerMinuteUSD: job.stats.costPerMinuteUsd,
    failedCount: job.stats.failedCount,
    effectiveWorkerCount: job.stats.effectiveWorkerCount,
    telemetryReason: job.stats.telemetryReason
  };
}

export function TranslationView({
  backend,
  library,
  config,
  onConfigChange,
  onOpenItemFolder,
  onNotify
}: {
  backend: BackendClient;
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
  const [maxBudgetBrl, setMaxBudgetBrl] = useState("");
  const [workerCount, setWorkerCount] = useState(1);
  const [sessionItems, setSessionItems] = useState<TranslationSessionItem[]>([]);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>(initialGlossaryTerms);
  const [termSource, setTermSource] = useState("");
  const [termTarget, setTermTarget] = useState("");
  const [estimate, setEstimate] = useState<TranslationEstimate | null>(null);
  const [automaticPlan, setAutomaticPlan] = useState<TranslationAutomaticPlan | null>(null);
  const [coverage, setCoverage] = useState<TranslationCoverage | null>(null);
  const [selectionHistory, setSelectionHistory] = useState<TranslationSelectionRecord[]>([]);
  const [memoryTerms, setMemoryTerms] = useState<TranslationMemoryTerm[]>([]);
  const [memoryConflicts, setMemoryConflicts] = useState<TranslationMemoryConflict[]>([]);
  const [memoryConflictSuggestions, setMemoryConflictSuggestions] = useState<TranslationMemoryConflictSuggestion[]>([]);
  const [resolvingConflictKeys, setResolvingConflictKeys] = useState<Set<string>>(() => new Set());
  const [applyGlossaryToExisting, setApplyGlossaryToExisting] = useState(false);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);
  const [busySessionIds, setBusySessionIds] = useState<Set<string>>(() => new Set());
  const [allowPaidProviders, setAllowPaidProviders] = useState(false);
  const [allowEditorialGrader, setAllowEditorialGrader] = useState(false);

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
  const recommendedModels = estimate?.recommendations.map((item) => item.model) ?? [];
  const selectableModels = ["automatic", ...(recommendedModels.length ? recommendedModels : modelOptions)];
  const selectedRecommendation = estimate?.recommendations.find((item) => item.model === model) ?? estimate?.recommendations[0] ?? null;
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
  const scopedSourceChars = selectedItem?.sourceChars
    ? Math.max(1, Math.round(selectedItem.sourceChars * (scopeChapters / selectedChapterCount)))
    : undefined;
  const fallbackSourceTokens = scopedSourceChars
    ? Math.max(1, Math.ceil(scopedSourceChars / 4))
    : scopeChapters * 2600;
  const estimatedInputTokens = fallbackSourceTokens
    + scopeChapters * Math.max(0, qualityProfile.inputTokensPerChapter - 2600);
  const estimatedOutputTokens = Math.round(
    fallbackSourceTokens * (qualityProfile.outputTokensPerChapter / 2600)
  );
  const fallbackEstimatedTokens = estimatedInputTokens + estimatedOutputTokens;
  const fallbackEstimatedUSD = (estimatedInputTokens / 1_000_000) * parseDecimal(inputUsdPerMillion)
    + (estimatedOutputTokens / 1_000_000) * parseDecimal(outputUsdPerMillion);
  const fallbackEstimatedBRL = fallbackEstimatedUSD * parseDecimal(usdBrl);
  const fullTranslationEstimatedUsd = selectedRecommendation?.estimatedUsd ?? fallbackEstimatedUSD;
  const fullTranslationEstimatedBrl = selectedRecommendation?.estimatedBrl ?? fallbackEstimatedBRL;
  const automaticEstimatedUsd = automaticPlan
    ? fullTranslationEstimatedUsd + automaticPlan.estimatedSampleUsd
    : undefined;
  const automaticEstimatedBrl = automaticPlan
    ? fullTranslationEstimatedBrl + (automaticPlan.estimatedSampleBrl ?? automaticPlan.estimatedSampleUsd * parseDecimal(usdBrl))
    : undefined;
  const estimatedEditorialGraderUsd = automaticPlan?.estimatedEditorialGraderUsd ?? 0;
  const estimatedEditorialGraderBrl = automaticPlan?.estimatedEditorialGraderBrl ?? estimatedEditorialGraderUsd * parseDecimal(usdBrl);
  const estimatedUSD = model === "automatic" && automaticEstimatedUsd !== undefined
    ? automaticEstimatedUsd
    : selectedRecommendation?.estimatedUsd ?? fallbackEstimatedUSD;
  const estimatedBRL = model === "automatic" && automaticEstimatedBrl !== undefined
    ? automaticEstimatedBrl
    : selectedRecommendation?.estimatedBrl ?? fallbackEstimatedBRL;
  const estimatedTokens = estimate
    ? estimate.estimatedInputTokens + estimate.estimatedOutputTokens
    : fallbackEstimatedTokens;
  const sessionEstimatedBRL = sessionItems.reduce((total, item) => total + item.estimatedBRL, 0);
  const sessionActualBRL = sessionItems.reduce((total, item) => total + (item.actualCostBRL ?? 0), 0);
  const sessionRemainingBRL = sessionItems.reduce((total, item) => total + (item.estimatedRemainingBRL ?? 0), 0);
  const sessionEtaSeconds = sessionItems.reduce((total, item) => total + (item.etaSeconds ?? 0), 0);
  const sessionTokens = sessionItems.reduce((total, item) => total + item.estimatedTokens, 0);
  const sessionChapters = sessionItems.reduce((total, item) => total + item.chapters, 0);
  const parsedBudgetBrl = parseDecimal(maxBudgetBrl);
  const maxBudgetUsd = parsedBudgetBrl > 0 && parseDecimal(usdBrl) > 0 ? parsedBudgetBrl / parseDecimal(usdBrl) : null;

  useEffect(() => {
    if (!selectableModels.includes(model)) {
      setModel(selectableModels[0]);
    }
  }, [model, selectableModels]);

  useEffect(() => {
    if (!allowPaidProviders && allowEditorialGrader) {
      setAllowEditorialGrader(false);
    }
  }, [allowEditorialGrader, allowPaidProviders]);

  useEffect(() => {
    if (!sessionItems.some((item) => item.jobId)) return;
    let cancelled = false;
    const refreshJobs = () => {
      void backend.listTranslationJobs()
        .then((jobs) => {
          if (cancelled) return;
          const jobById = new Map(jobs.map((job) => [job.id, job]));
          setSessionItems((items) => items.map((item) => {
            const job = item.jobId ? jobById.get(item.jobId) : null;
            return job ? patchSessionFromJob(item, job) : item;
          }));
        })
        .catch(() => undefined);
    };
    refreshJobs();
    const handle = window.setInterval(refreshJobs, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [backend, sessionItems]);

  useEffect(() => {
    if (!selectedItem) return;
    const nextEnd = Math.min(5, Math.max(1, selectedItem.chapters || 1));
    setRangeStart(1);
    setRangeEnd(nextEnd);
    setScope("pilot");
  }, [selectedItem?.id]);

  useEffect(() => {
    if (!selectedItem) {
      setSelectionHistory([]);
      setMemoryTerms([]);
      setMemoryConflicts([]);
      setMemoryConflictSuggestions([]);
      return;
    }
    let cancelled = false;
    const novelId = selectedItem.novelId ?? selectedItem.id;
    void Promise.all([
      backend.getTranslationSelectionHistory(novelId),
      backend.getTranslationMemory(novelId),
      backend.getTranslationMemoryConflicts(novelId),
      backend.getTranslationMemoryConflictSuggestions(novelId)
    ])
      .then(([records, terms, conflicts, suggestions]) => {
        if (!cancelled) {
          setSelectionHistory(records.slice(0, 3));
          setMemoryTerms(terms.slice(0, 5));
          setMemoryConflicts(conflicts.slice(0, 3));
          setMemoryConflictSuggestions(suggestions.slice(0, 3));
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectionHistory([]);
          setMemoryTerms([]);
          setMemoryConflicts([]);
          setMemoryConflictSuggestions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backend, selectedItem]);

  useEffect(() => {
    if (!selectedItem) {
      setEstimate(null);
      setCoverage(null);
      setEstimateError("");
      return;
    }
    const novelId = selectedItem.novelId ?? selectedItem.id;
    const chapterFrom = scope === "all" || scope === "pilot" ? 1 : clampedStart;
    const chapterTo = scope === "all" ? selectedChapterCount : scope === "pilot" ? pilotEnd : clampedEnd;
    let cancelled = false;
    setEstimating(true);
    setEstimateError("");
    const handle = window.setTimeout(() => {
      const request = {
        novelId,
        chapterFrom,
        chapterTo,
        mode: plannerMode(quality),
        usdBrlRate: parseDecimal(usdBrl),
        sourceChars: scopedSourceChars
      };
      void Promise.all([
        backend.estimateTranslation(request),
        backend.getTranslationCoverage(request)
      ])
        .then((payload) => {
          if (cancelled) return;
          const [estimatePayload, coveragePayload] = payload;
          setEstimate(estimatePayload);
          setCoverage(coveragePayload);
          if (model !== "automatic" && !estimatePayload.recommendations.some((item) => item.model === model)) {
            setModel(estimatePayload.recommendations[0]?.model ?? model);
          }
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setEstimate(null);
          setCoverage(null);
          setEstimateError(getErrorMessage(error, "Nao foi possivel estimar com o backend."));
        })
        .finally(() => {
          if (!cancelled) setEstimating(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [backend, clampedEnd, clampedStart, model, pilotEnd, quality, scope, selectedChapterCount, selectedItem, usdBrl]);

  useEffect(() => {
    if (!selectedItem || model !== "automatic") {
      setAutomaticPlan(null);
      return;
    }
    const novelId = selectedItem.novelId ?? selectedItem.id;
    const chapterFrom = scope === "all" || scope === "pilot" ? 1 : clampedStart;
    const chapterTo = scope === "all" ? selectedChapterCount : scope === "pilot" ? pilotEnd : clampedEnd;
    let cancelled = false;
    void backend.getTranslationAutomaticPlan({
      novelId,
      chapterFrom,
      chapterTo,
      mode: plannerMode(quality),
      maxSamples: 4,
      maxModels: 4,
      usdBrlRate: parseDecimal(usdBrl),
      sourceChars: scopedSourceChars
    }).then((payload) => {
      if (!cancelled) setAutomaticPlan(payload);
    }).catch(() => {
      if (!cancelled) setAutomaticPlan(null);
    });
    return () => {
      cancelled = true;
    };
  }, [backend, clampedEnd, clampedStart, model, pilotEnd, quality, scope, selectedChapterCount, selectedItem, usdBrl]);

  const addSessionItem = () => {
    if (!selectedItem) return;
    const chapterFrom = scope === "all" || scope === "pilot" ? 1 : clampedStart;
    const chapterTo = scope === "all" ? selectedChapterCount : scope === "pilot" ? pilotEnd : clampedEnd;
    const entry: TranslationSessionItem = {
      id: `${selectedItem.id}-${Date.now()}`,
      novelId: selectedItem.novelId ?? selectedItem.id,
      title: selectedItem.title,
      chapters: scopeChapters,
      chapterFrom,
      chapterTo,
      scopeLabel,
      qualityLabel: qualityProfile.label,
      mode: plannerMode(quality),
      model,
      provider: model === "automatic" ? "auto" : providerForModel(model, config.translationEngine),
      workerCount,
      estimatedBRL,
      estimatedTokens,
      sourceChars: scopedSourceChars,
      status: "ready"
    };
    setSessionItems((items) => [entry, ...items]);
    onNotify(`Lote de traducao preparado para ${selectedItem.title}.`);
  };

  const startSession = () => {
    const pendingItems = sessionItems.filter((item) => !item.jobId);
    if (pendingItems.length === 0) {
      onNotify("Todos os lotes preparados ja possuem job.");
      return;
    }
    const pendingIds = new Set(pendingItems.map((item) => item.id));
    setSessionItems((items) => items.map((item) => pendingIds.has(item.id) ? { ...item, status: "waiting" } : item));
    void Promise.all(pendingItems.map((item) => backend.createTranslationJob({
      novelId: item.novelId,
      chapterFrom: item.chapterFrom,
      chapterTo: item.chapterTo,
      targetLanguage: config.targetLanguage,
      mode: item.mode,
      strategy: item.model === "automatic" ? "automatic" : "manual",
      selectedModel: item.model,
      provider: item.provider,
      workerCount: item.workerCount,
      reuseExisting: true,
      maxCostUsd: maxBudgetUsd,
      usdBrlRate: parseDecimal(usdBrl),
      sourceChars: item.sourceChars
    }).then((job) => ({ itemId: item.id, jobId: job.id }))))
      .then((created) => {
        const jobByItem = new Map(created.map((item) => [item.itemId, item.jobId]));
        setSessionItems((items) => items.map((item) => ({ ...item, jobId: jobByItem.get(item.id), status: "waiting" })));
        onNotify(`${created.length} job(s) de traducao criados.`);
      })
      .catch((error: unknown) => {
        setSessionItems((items) => items.map((item) => ({ ...item, status: "ready" })));
        onNotify(getErrorMessage(error, "Nao foi possivel criar os jobs de traducao."));
      });
  };

  const setSessionBusy = (itemId: string, busy: boolean) => {
    setBusySessionIds((items) => {
      const next = new Set(items);
      if (busy) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const applyJobToSession = (itemId: string, job: TranslationJob) => {
    setSessionItems((items) => items.map((item) => item.id === itemId
      ? patchSessionFromJob(item, job)
      : item));
  };

  const runSessionJob = (item: TranslationSessionItem) => {
    if (!item.jobId) return;
    setSessionBusy(item.id, true);
    void backend.runTranslationJob(item.jobId, allowPaidProviders, allowEditorialGrader)
      .then((job) => {
        applyJobToSession(item.id, job);
        onNotify(allowPaidProviders
          ? `Job enviado para execucao com providers pagos${allowEditorialGrader ? " e grader editorial" : ""}.`
          : "Job enviado para execucao segura. Providers pagos continuam bloqueados por padrao.");
      })
      .catch((error: unknown) => {
        onNotify(getErrorMessage(error, "Nao foi possivel executar o job."));
      })
      .finally(() => setSessionBusy(item.id, false));
  };

  const pauseSessionJob = (item: TranslationSessionItem) => {
    if (!item.jobId) return;
    setSessionBusy(item.id, true);
    void backend.pauseTranslationJob(item.jobId)
      .then((job) => applyJobToSession(item.id, job))
      .catch((error: unknown) => onNotify(getErrorMessage(error, "Nao foi possivel pausar o job.")))
      .finally(() => setSessionBusy(item.id, false));
  };

  const resumeSessionJob = (item: TranslationSessionItem) => {
    if (!item.jobId) return;
    setSessionBusy(item.id, true);
    void backend.resumeTranslationJob(item.jobId)
      .then((job) => applyJobToSession(item.id, job))
      .catch((error: unknown) => onNotify(getErrorMessage(error, "Nao foi possivel retomar o job.")))
      .finally(() => setSessionBusy(item.id, false));
  };

  const cancelSessionJob = (item: TranslationSessionItem) => {
    if (!item.jobId) return;
    setSessionBusy(item.id, true);
    void backend.cancelTranslationJob(item.jobId)
      .then((job) => applyJobToSession(item.id, job))
      .catch((error: unknown) => onNotify(getErrorMessage(error, "Nao foi possivel cancelar o job.")))
      .finally(() => setSessionBusy(item.id, false));
  };

  const addGlossaryTerm = () => {
    const source = termSource.trim();
    const target = termTarget.trim();
    if (!source || !target) return;
    const novelId = selectedItem?.novelId ?? selectedItem?.id;
    setGlossaryTerms((items) => [
      { id: `${source}-${Date.now()}`, source, target, note: "Adicionado na central de traducao." },
      ...items
    ]);
    if (novelId) {
      void backend.upsertTranslationMemoryTerm({
        novelId,
        source,
        target,
        targetLanguage: config.targetLanguage,
        status: "locked",
        category: "manual",
        notes: "Adicionado na central de traducao.",
        applyExisting: applyGlossaryToExisting
      }).then((payload) => {
        setMemoryTerms((items) => [payload.term, ...items.filter((item) => item.source.toLowerCase() !== source.toLowerCase())].slice(0, 5));
        if (payload.postEdit) {
          onNotify(`Termo salvo. Post-edit: ${payload.postEdit.changedCount} arquivo(s) alterado(s), ${payload.postEdit.skippedCount} ignorado(s).`);
        }
      }).catch(() => undefined);
    }
    setTermSource("");
    setTermTarget("");
  };

  const conflictKey = (source: string, relatedSource: string, conflictType: string) => (
    `${conflictType}:${[source.toLowerCase(), relatedSource.toLowerCase()].sort().join(":")}`
  );

  const suggestionForConflict = (conflict: TranslationMemoryConflict) => memoryConflictSuggestions.find((suggestion) => (
    suggestion.conflictType === conflict.conflictType
    && conflictKey(suggestion.source, suggestion.relatedSource, suggestion.conflictType) === conflictKey(conflict.source, conflict.relatedSource, conflict.conflictType)
  ));

  const applyConflictSuggestion = (suggestion: TranslationMemoryConflictSuggestion) => {
    if (suggestion.action === "review_only") return;
    const key = conflictKey(suggestion.source, suggestion.relatedSource, suggestion.conflictType);
    setResolvingConflictKeys((items) => new Set(items).add(key));
    void backend.resolveTranslationMemoryConflict({
      novelId: suggestion.novelId,
      source: suggestion.source,
      target: suggestion.suggestedTarget,
      targetLanguage: config.targetLanguage,
      applyExisting: applyGlossaryToExisting
    })
      .then((payload) => {
        setMemoryTerms((items) => [payload.term, ...items.filter((item) => item.source.toLowerCase() !== payload.term.source.toLowerCase())].slice(0, 5));
        setMemoryConflicts((items) => items.filter((item) => conflictKey(item.source, item.relatedSource, item.conflictType) !== key));
        setMemoryConflictSuggestions((items) => items.filter((item) => conflictKey(item.source, item.relatedSource, item.conflictType) !== key));
        const postEditSummary = payload.postEdit
          ? ` Post-edit: ${payload.postEdit.changedCount} arquivo(s) alterado(s), ${payload.postEdit.skippedCount} ignorado(s).`
          : "";
        onNotify(payload.remainingConflictCount > 0
          ? `Sugestao aplicada. Ainda ha ${payload.remainingConflictCount} alerta(s) no glossario.${postEditSummary}`
          : `Sugestao aplicada. Glossario sem alertas pendentes.${postEditSummary}`);
      })
      .catch((error: unknown) => onNotify(getErrorMessage(error, "Nao foi possivel aplicar a sugestao do glossario.")))
      .finally(() => {
        setResolvingConflictKeys((items) => {
          const next = new Set(items);
          next.delete(key);
          return next;
        });
      });
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
            <strong>{currencyBRL.format(sessionActualBRL)}</strong>
          </article>
          <article className="translation-metric">
            <span>Restante / ETA</span>
            <strong>{currencyBRL.format(sessionRemainingBRL)} / {durationLabel(sessionEtaSeconds)}</strong>
          </article>
          <article className="translation-metric">
            <span>Capitulos / tokens</span>
            <strong>{sessionChapters.toLocaleString("pt-BR")} / {sessionTokens.toLocaleString("pt-BR")}</strong>
          </article>
        </div>

        <div className="translation-coverage-strip">
          <span>
            Reaproveitamento: <strong>{coverage ? `${coverage.translatedCount}/${coverage.selectedCount}` : "calculando"}</strong>
          </span>
          <span>
            Faltam: <strong>{coverage ? coverage.missingCount.toLocaleString("pt-BR") : "-"}</strong>
          </span>
          <span>
            Economia: <strong>{coverage?.estimatedSavingsBrl ? currencyBRL.format(coverage.estimatedSavingsBrl) : currencyBRL.format(0)}</strong>
          </span>
          <span title={coverage ? coverageRangeLabel(coverage.ranges) : ""}>
            Faixas: <strong>{coverage ? coverageRangeLabel(coverage.ranges) : "-"}</strong>
          </span>
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
                  {selectableModels.map((option) => (
                    <option key={option} value={option}>
                      {option === "automatic" ? "Automatico (escolher melhor)" : option}
                    </option>
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
            <div className="field-group">
              <label htmlFor="translation-budget-brl">Orcamento maximo BRL</label>
              <input
                id="translation-budget-brl"
                inputMode="decimal"
                placeholder="Sem limite"
                value={maxBudgetBrl}
                onChange={(event) => setMaxBudgetBrl(event.target.value)}
              />
            </div>
            <div className="field-group">
              <label htmlFor="translation-workers">Workers paralelos</label>
              <input
                id="translation-workers"
                type="number"
                min={1}
                max={8}
                value={workerCount}
                onChange={(event) => setWorkerCount(Math.max(1, Math.min(8, Number(event.target.value) || 1)))}
              />
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
            <div className="translation-model-recommendations">
              {estimating ? (
                <div className="translation-model-state">Calculando recomendacoes...</div>
              ) : estimate?.recommendations.length ? estimate.recommendations.slice(0, 4).map((item, index) => (
                <button
                  className={`translation-model-card ${model === item.model ? "active" : ""}`}
                  key={item.model}
                  onClick={() => setModel(item.model)}
                  aria-pressed={model === item.model}
                >
                  <span className="translation-model-card-heading">
                    <strong>{index === 0 ? "Recomendado" : item.experimental ? "Experimental" : "Opcao"}</strong>
                    <small>{item.qualityScore ? `${item.qualityScore.toFixed(1)} pts` : "sem score"}</small>
                  </span>
                  <span className="translation-model-name">{item.model}</span>
                  <span className="translation-model-card-meta">
                    <span>{currencyUSD.format(item.estimatedUsd)}</span>
                    <span>{item.estimatedBrl ? currencyBRL.format(item.estimatedBrl) : "BRL indisponivel"}</span>
                    <span>{durationLabel(item.estimatedDurationSeconds)}</span>
                  </span>
                </button>
              )) : (
                <div className="translation-model-state">
                  {estimateError || "Precos manuais ativos ate o backend retornar uma estimativa."}
                </div>
              )}
            </div>
            {selectionHistory.length ? (
              <div className="translation-selection-history">
                <strong>Historico automatico</strong>
                {selectionHistory.map((record) => (
                  <span key={record.id}>
                    {record.winnerModel} venceu em {record.sampleChapters.length || 0} amostra(s)
                    {record.editorialGradeCount ? ` com ${record.editorialGradeCount} grade(s)` : ""}
                  </span>
                ))}
              </div>
            ) : null}
            <div className="translation-cost-line">
              <span>{currencyUSD.format(estimatedUSD)}</span>
              <strong>{currencyBRL.format(estimatedBRL)}</strong>
            </div>
            {model === "automatic" && estimatedEditorialGraderUsd > 0 ? (
              <div className="translation-grader-cost-line">
                <span>Grader editorial opcional</span>
                <strong>{currencyUSD.format(estimatedEditorialGraderUsd)} / {currencyBRL.format(estimatedEditorialGraderBrl)}</strong>
              </div>
            ) : null}
          </article>
        </div>

        <section className="translation-session-panel">
          <div className="pane-header">
            <div>
              <h3>Lotes preparados</h3>
              <span>{sessionItems.length} item(ns)</span>
            </div>
            <div className="translation-session-toolbar">
              <label className="translation-paid-toggle">
                <input
                  type="checkbox"
                  checked={allowPaidProviders}
                  onChange={(event) => setAllowPaidProviders(event.target.checked)}
                />
                <span>Liberar providers pagos</span>
              </label>
              <label className="translation-paid-toggle">
                <input
                  type="checkbox"
                  checked={allowEditorialGrader}
                  disabled={!allowPaidProviders}
                  onChange={(event) => setAllowEditorialGrader(event.target.checked)}
                />
                <span>Usar grader editorial</span>
              </label>
              <button className="button primary" onClick={startSession} disabled={sessionItems.length === 0}>
                <Play size={15} />
                Preparar execucao
              </button>
            </div>
          </div>
          <div className="translation-session-list">
            {sessionItems.length === 0 ? (
              <div className="empty-state compact">Nenhum lote preparado.</div>
            ) : sessionItems.map((item) => {
                const isBusy = busySessionIds.has(item.id);
                const canRun = Boolean(item.jobId) && (item.status === "waiting" || item.status === "ready" || item.status === "paused");
                const canPause = Boolean(item.jobId) && item.status === "translating";
                const canResume = Boolean(item.jobId) && item.status === "paused";
                const canCancel = Boolean(item.jobId) && item.status !== "done" && item.status !== "cancelled";
                return (
                  <article className={`translation-session-row ${item.status}`} key={item.id}>
                    <div className="translation-session-main">
                      <strong>{item.title}</strong>
                      <span>{item.scopeLabel} - {item.qualityLabel} - {item.model} - {item.workerCount} worker(s){item.jobId ? ` - job ${item.jobId.slice(0, 8)}` : ""}</span>
                    </div>
                    <div className="translation-session-numbers">
                      <strong>
                        {item.actualCostBRL && item.actualCostBRL > 0
                          ? currencyBRL.format(item.actualCostBRL)
                          : currencyBRL.format(item.estimatedBRL)}
                      </strong>
                      <span>
                        {item.progressPercent !== undefined ? `${Math.round(item.progressPercent)}% - ` : ""}
                        {item.chapters.toLocaleString("pt-BR")} cap. - {item.status}
                      </span>
                      {item.telemetryReason ? (
                        <span title={item.telemetryReason}>
                          ETA {durationLabel(item.etaSeconds)} - restante {currencyBRL.format(item.estimatedRemainingBRL ?? 0)} - {item.effectiveWorkerCount ?? item.workerCount} worker(s)
                        </span>
                      ) : null}
                      {(item.retryCount || item.repairCount || item.failedCount) ? (
                        <span>
                          retries {item.retryCount ?? 0} ({(item.retryRatePercent ?? 0).toFixed(1)}%) - reparos {item.repairCount ?? 0} ({(item.repairRatePercent ?? 0).toFixed(1)}%) - falhas {item.failedCount ?? 0}
                        </span>
                      ) : null}
                      {item.providerStabilityPercent !== undefined ? (
                        <span>
                          estabilidade {item.providerStabilityPercent.toFixed(1)}% - custo/min US$ {(item.costPerMinuteUSD ?? 0).toFixed(4)}
                        </span>
                      ) : null}
                    </div>
                    <div className="translation-session-actions">
                      {canRun ? (
                        <button
                          className="toolbar-control"
                          title="Executar job"
                          aria-label={`Executar job de ${item.title}`}
                          disabled={isBusy}
                          onClick={() => runSessionJob(item)}
                        >
                          <Play size={14} />
                        </button>
                      ) : null}
                      {canPause ? (
                        <button
                          className="toolbar-control"
                          title="Pausar job"
                          aria-label={`Pausar job de ${item.title}`}
                          disabled={isBusy}
                          onClick={() => pauseSessionJob(item)}
                        >
                          <Pause size={14} />
                        </button>
                      ) : null}
                      {canResume ? (
                        <button
                          className="toolbar-control"
                          title="Retomar job"
                          aria-label={`Retomar job de ${item.title}`}
                          disabled={isBusy}
                          onClick={() => resumeSessionJob(item)}
                        >
                          <RotateCcw size={14} />
                        </button>
                      ) : null}
                      {canCancel ? (
                        <button
                          className="toolbar-control"
                          title="Cancelar job"
                          aria-label={`Cancelar job de ${item.title}`}
                          disabled={isBusy}
                          onClick={() => cancelSessionJob(item)}
                        >
                          <XCircle size={14} />
                        </button>
                      ) : null}
                      <button
                        className="toolbar-control"
                        title="Remover lote"
                        aria-label={`Remover lote de ${item.title}`}
                        disabled={isBusy}
                        onClick={() => setSessionItems((items) => items.filter((entry) => entry.id !== item.id))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                );
              })}
          </div>
        </section>
      </section>

      <aside className="library-detail-panel translation-side-panel">
        <div className="library-detail-heading">
          <div>
            <h3>Glossario</h3>
            <span>{glossaryTerms.length} termo(s) manuais - {memoryTerms.length} auto - {memoryConflicts.length} alerta(s)</span>
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
          <label className="translation-glossary-toggle">
            <input
              type="checkbox"
              checked={applyGlossaryToExisting}
              onChange={(event) => setApplyGlossaryToExisting(event.target.checked)}
            />
            <span>Aplicar em traducoes existentes</span>
          </label>
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
          {memoryTerms.map((term) => (
            <article className="translation-glossary-row automatic" key={`${term.source}-${term.target}`}>
              <div>
                <strong>{term.source}</strong>
                <span>{term.target}</span>
              </div>
              <small>{term.status} - {term.occurrences} uso(s)</small>
            </article>
          ))}
          {memoryConflicts.map((conflict) => {
            const suggestion = suggestionForConflict(conflict);
            const key = conflictKey(conflict.source, conflict.relatedSource, conflict.conflictType);
            const canApply = Boolean(suggestion && suggestion.action !== "review_only");
            return (
              <article className="translation-glossary-row conflict" key={key}>
                <div>
                  <strong>{conflict.source} / {conflict.relatedSource}</strong>
                  <span>{suggestion && canApply ? `Sugerido: ${suggestion.source} -> ${suggestion.suggestedTarget}` : `${conflict.target} / ${conflict.relatedTarget}`}</span>
                </div>
                <small>{conflict.severity} - {suggestion?.reason ?? conflict.message}</small>
                {canApply && suggestion ? (
                  <button
                    className="toolbar-control"
                    title="Aplicar sugestao"
                    aria-label={`Aplicar sugestao para ${suggestion.source}`}
                    disabled={resolvingConflictKeys.has(conflictKey(suggestion.source, suggestion.relatedSource, suggestion.conflictType))}
                    onClick={() => applyConflictSuggestion(suggestion)}
                  >
                    <Check size={14} />
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      </aside>
    </section>
  );
}
