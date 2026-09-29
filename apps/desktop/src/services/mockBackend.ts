import type {
  BootstrapPayload,
  Chapter,
  ChapterPreset,
  ChapterSelection,
  Filters,
  IndexMode,
  KindleDeviceStatus,
  LibraryItem,
  Novel,
  QueueItem,
  ServerProbe,
  SourceSite,
  TagCatalogItem,
  TranslationAutomaticPlan,
  TranslationAutomaticPlanRequest,
  TranslationCoverage,
  TranslationEstimate,
  TranslationEstimateRequest,
  TranslationJob,
  TranslationJobCreateRequest,
  TranslationMemoryConflict,
  TranslationMemoryConflictResolveRequest,
  TranslationMemoryConflictResolveResult,
  TranslationMemoryConflictSuggestion,
  TranslationMemoryTerm,
  TranslationMemoryTermUpsertRequest,
  TranslationMemoryTermUpsertResult,
  TranslationSelectionRecord
} from "../core/types";
import type { BackendClient } from "./backendClient";
import { buildFallbackTagCatalog, matchesContentRating, matchesTagFilters } from "../core/tagFilters";

let latencyScale = 1;

/**
 * Scales every simulated network delay of the mock backend. Tests set it to 0
 * so async flows still resolve on a later macrotask, just without real waits.
 */
export function setMockLatencyScale(scale: number) {
  latencyScale = Math.max(0, scale);
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms * latencyScale));
const jitter = (base = 420) => wait(base + Math.round(Math.random() * 420));

const kindleDeviceStatus: KindleDeviceStatus = {
  id: "kindle-paperwhite-11",
  deviceName: "Kindle Paperwhite",
  connected: true,
  mountPath: "E:\\documents",
  targetFormat: "AZW3"
};

const defaultServerConfig = {
  serverName: "Oghma Index Node",
  version: "0.4.2-mock",
  storageRoot: "/srv/oghma"
};

const sources: SourceSite[] = [
  {
    id: "central-novel",
    name: "Central Novel",
    baseUrl: "https://centralnovel.com/",
    count: 1248,
    status: "online",
    enabled: true,
    mode: "javascript_required",
    lastSync: "Hoje, 01:14",
    delayMs: 1400
  },
  {
    id: "novel-mania",
    name: "Novel Mania",
    baseUrl: "https://novelmania.com.br/",
    count: 892,
    status: "syncing",
    enabled: true,
    mode: "static_html",
    lastSync: "Ontem, 23:02",
    delayMs: 950
  },
  {
    id: "local",
    name: "Servidor local",
    baseUrl: "http://192.168.0.42:8000/",
    count: 321,
    status: "offline",
    enabled: false,
    mode: "api_available",
    lastSync: "Biblioteca local",
    delayMs: 220
  }
];

const novels: Novel[] = [
  {
    id: "enchanted-forest",
    title: "The Enchanted Forest",
    author: "Emily Bronte",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Fantasia", "Misterio"],
    tagKeys: ["genre.fantasy", "genre.mystery"],
    status: "ongoing",
    chapters: 142,
    language: "PT-BR",
    updatedAt: "Hoje",
    description: "A captivating tale of love and mystery in an ancient forest.",
    coverClass: "cover-c"
  },
  {
    id: "whispers-night",
    title: "Whispers of the Night",
    author: "Edgar Allan Poe",
    sourceId: "novel-mania",
    sourceName: "Novel Mania",
    tags: ["Misterio", "Drama", "Ecchi"],
    tagKeys: ["genre.mystery", "genre.drama", "genre.ecchi"],
    status: "complete",
    chapters: 58,
    language: "PT-BR",
    updatedAt: "Ontem",
    description: "A collection of haunting tales that delve into the unknown.",
    coverClass: "cover-d"
  },
  {
    id: "journey-unknown",
    title: "Journey to the Unknown",
    author: "Jules Verne",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Aventura"],
    tagKeys: ["genre.adventure"],
    status: "ongoing",
    chapters: 211,
    language: "PT-BR",
    updatedAt: "Hoje",
    description: "A thrilling adventure into uncharted territories.",
    coverClass: "cover-e"
  },
  {
    id: "enchanted-secrets",
    title: "Secrets of the Enchanted Forest",
    author: "John Smith",
    sourceId: "novel-mania",
    sourceName: "Novel Mania",
    tags: ["Fantasia"],
    tagKeys: ["genre.fantasy"],
    status: "paused",
    chapters: 36,
    language: "PT-BR",
    updatedAt: "Semana passada",
    description: "An archive of short fragments from a lost enchanted realm.",
    coverClass: "cover-f"
  },
  {
    id: "dark-storm",
    title: "Castle of the Dark Storm",
    author: "Mary Shelley",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Fantasia", "Drama"],
    tagKeys: ["genre.fantasy", "genre.drama"],
    status: "complete",
    chapters: 89,
    language: "PT-BR",
    updatedAt: "2 dias",
    description: "A castle sealed by weather, memory, and old promises.",
    coverClass: "cover-g"
  },
  {
    id: "labyrinth",
    title: "The Labyrinth's Secret",
    author: "John Smith",
    sourceId: "novel-mania",
    sourceName: "Novel Mania",
    tags: ["Misterio"],
    tagKeys: ["genre.mystery"],
    status: "complete",
    chapters: 74,
    language: "PT-BR",
    updatedAt: "3 dias",
    description: "A puzzle story built around a library under the city.",
    coverClass: "cover-h"
  },
  {
    id: "lost-temple",
    title: "Mystery of the Lost Temple",
    author: "Jules Verne",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Aventura"],
    tagKeys: ["genre.adventure"],
    status: "ongoing",
    chapters: 19,
    language: "PT-BR",
    updatedAt: "Hoje",
    description: "A compact expedition novel with many maps and notes.",
    coverClass: "cover-i"
  },
  {
    id: "mockingbird",
    title: "To Kill a Mockingbird",
    author: "Harper Lee",
    sourceId: "local",
    sourceName: "Servidor local",
    tags: ["Drama"],
    tagKeys: ["genre.drama"],
    status: "complete",
    chapters: 31,
    language: "PT-BR",
    updatedAt: "Local",
    description: "Local sample item used to test exports and queue behavior.",
    coverClass: "cover-j"
  },
  {
    id: "shadow-woods",
    title: "Whispers in the Shadow Woods",
    author: "Emily Bronte",
    sourceId: "novel-mania",
    sourceName: "Novel Mania",
    tags: ["Fantasia", "Misterio"],
    tagKeys: ["genre.fantasy", "genre.mystery"],
    status: "ongoing",
    chapters: 126,
    language: "PT-BR",
    updatedAt: "4 dias",
    description: "A slow mystery with a large cast and rotating narrators.",
    coverClass: "cover-k"
  },
  {
    id: "forgotten-kingdom",
    title: "Journey to the Forgotten Kingdom",
    author: "John Smith",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Isekai", "Aventura"],
    tagKeys: ["genre.isekai", "genre.adventure"],
    status: "ongoing",
    chapters: 2064,
    language: "PT-BR",
    updatedAt: "Hoje",
    description: "A long-running epic used to test very large chapter ranges.",
    coverClass: "cover-l"
  },
  {
    id: "silver-archive",
    title: "Silver Archive Chronicles",
    author: "Lia Martins",
    sourceId: "central-novel",
    sourceName: "Central Novel",
    tags: ["Fantasia"],
    tagKeys: ["genre.fantasy"],
    status: "ongoing",
    chapters: 487,
    language: "PT-BR",
    updatedAt: "Ontem",
    description: "A preservation-friendly series with regular updates.",
    coverClass: "cover-m"
  },
  {
    id: "blue-citadel",
    title: "The Blue Citadel",
    author: "R. A. Lima",
    sourceId: "novel-mania",
    sourceName: "Novel Mania",
    tags: ["Isekai", "Drama", "Adulto"],
    tagKeys: ["genre.isekai", "genre.drama", "genre.adult"],
    status: "paused",
    chapters: 233,
    language: "PT-BR",
    updatedAt: "6 dias",
    description: "A paused translation with many partially indexed chapters.",
    coverClass: "cover-n"
  }
];

const library: LibraryItem[] = [
  {
    id: "lib-mockingbird",
    novelId: "enchanter-forest",
    title: "To Kill a Mockingbird",
    author: "Harper Lee",
    format: "EPUB",
    formats: ["EPUB"],
    chapters: 31,
    sizeMb: 15,
    coverClass: "cover-c",
    coverUrl: "/icons/oghma-icon.svg",
    bundleKey: novels[0].bundleKey,
    description: "A cópia local preservada fica disponível para conversão e leitura mesmo sem depender do site de origem.",
    sourceName: "Central Novel",
    outputDir: "~/Documents/Oghma Library/exports/To Kill a Mockingbird",
    files: ["To Kill a Mockingbird.epub"],
    exportedAt: "Hoje, 00:51"
  },
  {
    id: "lib-lost-temple",
    novelId: "lost-temple",
    title: "Mystery of the Lost Temple",
    author: "Jules Verne",
    format: "EPUB",
    formats: ["EPUB", "PDF"],
    chapters: 19,
    sizeMb: 11,
    coverClass: "cover-i",
    description: "Uma aventura local com múltiplos formatos já gerados.",
    sourceName: "Novel Mania",
    outputDir: "~/Documents/Oghma Library/exports/Mystery of the Lost Temple",
    files: ["Mystery of the Lost Temple.epub", "Mystery of the Lost Temple.pdf"],
    exportedAt: "Ontem, 20:10"
  }
];

const queue: QueueItem[] = [
  {
    id: "q-1",
    novelId: "mockingbird",
    title: "To Kill a Mockingbird",
    coverClass: "cover-j",
    preset: "range",
    rangeLabel: "Capítulos 1-20",
    progress: 82,
    state: "downloading",
    chaptersTotal: 20,
    formats: ["EPUB"],
    translate: false,
    audiobook: false
  },
  {
    id: "q-2",
    novelId: "forgotten-kingdom",
    title: "Journey to the Forgotten Kingdom",
    coverClass: "cover-l",
    preset: "all",
    rangeLabel: "Todos os 2.064 capítulos",
    progress: 0,
    state: "queued",
    chaptersTotal: 2064,
    formats: ["EPUB", "PDF"],
    translate: true,
    audiobook: false
  },
  {
    id: "q-3",
    novelId: "whispers-night",
    title: "Whispers of the Night",
    coverClass: "cover-d",
    preset: "all",
    rangeLabel: "Todos os 58 capítulos",
    progress: 100,
    state: "done",
    chaptersTotal: 58,
    formats: ["EPUB", "TXT"],
    translate: false,
    audiobook: false
  },
  {
    id: "q-4",
    novelId: "labyrinth-secret",
    title: "The Labyrinth's Secret",
    coverClass: "cover-h",
    preset: "all",
    rangeLabel: "Todos os 74 capítulos",
    progress: 100,
    state: "done",
    chaptersTotal: 74,
    formats: ["PDF"],
    translate: false,
    audiobook: false
  }
];

const tagCatalog: TagCatalogItem[] = buildFallbackTagCatalog(novels).map((tag) => {
  const labels: Record<string, string> = {
    "genre.fantasy": "Fantasia",
    "genre.mystery": "Misterio",
    "genre.drama": "Drama",
    "genre.adventure": "Aventura",
    "genre.isekai": "Isekai"
  };
  return labels[tag.key] ? { ...tag, label: labels[tag.key], reviewStatus: "curated" } : tag;
});

function chapterTitle(index: number) {
  const names = ["O bosque desperta", "Uma carta sem remetente", "O mapa incompleto", "A torre submersa", "Notas do tradutor", "A porta no arquivo"];
  return names[(index - 1) % names.length];
}

function modeLatency(indexMode: IndexMode) {
  if (indexMode === "catalog_only") return 78;
  if (indexMode === "guarded_refresh") return 124;
  return 96;
}

function buildMockTranslationEstimate(request: TranslationEstimateRequest): TranslationEstimate {
  const novel = novels.find((item) => item.id === request.novelId)
    ?? library.find((item) => item.novelId === request.novelId || item.id === request.novelId);
  const max = novel?.chapters ?? Math.max(1, request.chapterTo);
  const chapterFrom = Math.max(1, Math.min(request.chapterFrom, max));
  const chapterTo = Math.max(chapterFrom, Math.min(request.chapterTo, max));
  const chapterCount = Math.max(1, chapterTo - chapterFrom + 1);
  const sourceChars = Math.max(chapterCount, request.sourceChars ?? chapterCount * 11200);
  const estimatedSourceTokens = Math.max(1, Math.ceil(sourceChars / 4));
  const estimatedInputTokens = estimatedSourceTokens + chapterCount * 1200;
  const estimatedOutputTokens = Math.round(estimatedSourceTokens * 1.18);
  const equivalentChapterCount = Math.max(chapterCount, sourceChars / 11200);
  const usdBrlRate = request.usdBrlRate ?? null;
  const models = request.models?.length
    ? request.models
    : ["google/gemini-3-flash-preview", "gpt-5.4-mini", "gpt-4.1-mini", "deepseek/deepseek-v4-pro", "deepseek/deepseek-v4-flash"];
  const profiles: Record<string, { input: number; output: number; quality: number; duration: number; gate: number; experimental?: boolean }> = {
    "google/gemini-3-flash-preview": { input: 0.5, output: 3, quality: 81.75, duration: 21.83, gate: 1 },
    "gpt-5.4-mini": { input: 0.75, output: 4.5, quality: 79.58, duration: 52, gate: 1 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6, quality: 77.94, duration: 38, gate: 1 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, quality: 77.96, duration: 224.39, gate: 1 },
    "deepseek/deepseek-v4-flash": { input: 0.09, output: 0.18, quality: 79.42, duration: 98.35, gate: 0.5, experimental: true }
  };
  const costs = models.map((model) => {
    const profile = profiles[model] ?? { input: 0.75, output: 4.5, quality: 70, duration: 60, gate: 0.85 };
    const usd = (estimatedInputTokens / 1_000_000) * profile.input + (estimatedOutputTokens / 1_000_000) * profile.output;
    return { model, profile, usd };
  });
  const maxCost = Math.max(...costs.map((item) => item.usd), 1);
  const maxDuration = Math.max(...costs.map((item) => item.profile.duration), 1);
  const recommendations = costs.map(({ model, profile, usd }) => {
    const score = (profile.quality / 100) * 0.45
      + profile.gate * 0.2
      + (1 - usd / maxCost) * 0.25
      + (1 - profile.duration / maxDuration) * 0.1
      - (profile.experimental ? 0.15 : 0);
    return {
      model,
      estimatedUsd: Number(usd.toFixed(6)),
      estimatedBrl: usdBrlRate ? Number((usd * usdBrlRate).toFixed(6)) : null,
      estimatedDurationSeconds: Number((profile.duration * equivalentChapterCount).toFixed(3)),
      qualityScore: profile.quality,
      gatePassRate: profile.gate,
      recommendationScore: Number(score.toFixed(6)),
      experimental: Boolean(profile.experimental),
      priceTimestamp: new Date().toISOString(),
      notes: profile.experimental ? ["Barato, mas falhou em mojibake/glossario no piloto."] : []
    };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore);
  return {
    novelId: request.novelId,
    chapterFrom,
    chapterTo,
    chapterCount,
    sourceChars,
    estimatedInputTokens,
    estimatedOutputTokens,
    mode: request.mode,
    recommendations
  };
}

function buildMockTranslationCoverage(request: TranslationEstimateRequest): TranslationCoverage {
  const novel = novels.find((item) => item.id === request.novelId)
    ?? library.find((item) => item.novelId === request.novelId || item.id === request.novelId);
  const max = novel?.chapters ?? Math.max(1, request.chapterTo);
  const chapterFrom = Math.max(1, Math.min(request.chapterFrom, max));
  const chapterTo = Math.max(chapterFrom, Math.min(request.chapterTo, max));
  const selectedCount = Math.max(1, chapterTo - chapterFrom + 1);
  const hasReusableMock = request.novelId.includes("lost") || request.novelId.includes("enchant") || request.novelId.includes("forest");
  const translatedCount = hasReusableMock ? Math.min(selectedCount, Math.max(0, Math.floor(selectedCount * 0.42))) : 0;
  const start = chapterFrom;
  const end = translatedCount > 0 ? chapterFrom + translatedCount - 1 : chapterFrom;
  const savingsUsd = translatedCount * 0.012;
  return {
    novelId: request.novelId,
    chapterFrom,
    chapterTo,
    targetLanguage: "pt-BR",
    selectedCount,
    translatedCount,
    missingCount: selectedCount - translatedCount,
    staleCount: 0,
    unknownCount: 0,
    coveragePercent: Number(((translatedCount / selectedCount) * 100).toFixed(3)),
    ranges: translatedCount > 0 ? [{ start, end, count: translatedCount, freshness: "fresh" }] : [],
    staleRanges: [],
    unknownRanges: [],
    estimatedSavingsUsd: Number(savingsUsd.toFixed(6)),
    estimatedSavingsBrl: request.usdBrlRate ? Number((savingsUsd * request.usdBrlRate).toFixed(6)) : null
  };
}

const translationJobs: TranslationJob[] = [];

function updateMockTranslationJob(jobId: string, patch: Partial<TranslationJob>): TranslationJob {
  const index = translationJobs.findIndex((job) => job.id === jobId);
  if (index < 0) throw new Error("Trabalho de tradução não encontrado");
  const next = { ...translationJobs[index], ...patch, updatedAt: new Date().toISOString() };
  translationJobs[index] = next;
  return structuredClone(next);
}

function buildMockTranslationJob(request: TranslationJobCreateRequest): TranslationJob {
  const coverage = buildMockTranslationCoverage({
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    mode: request.mode,
    usdBrlRate: request.usdBrlRate
  });
  const estimate = buildMockTranslationEstimate({
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    mode: request.mode,
    models: [request.selectedModel],
    usdBrlRate: request.usdBrlRate,
    sourceChars: request.sourceChars
  });
  const recommendation = estimate.recommendations[0];
  const now = new Date().toISOString();
  return {
    id: `mock-translation-${Date.now()}-${translationJobs.length}`,
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    targetLanguage: request.targetLanguage,
    mode: request.mode,
    strategy: request.strategy,
    status: "queued",
    selectedModel: request.selectedModel,
    provider: request.provider,
    workerCount: request.workerCount,
    reuseExisting: request.reuseExisting,
    maxCostUsd: request.maxCostUsd ?? null,
    stats: {
      selectedCount: coverage.selectedCount,
      translatedCount: 0,
      reusableCount: coverage.translatedCount,
      missingCount: coverage.missingCount,
      staleCount: coverage.staleCount,
      unknownCount: coverage.unknownCount,
      estimatedSavingsUsd: coverage.estimatedSavingsUsd,
      estimatedSavingsBrl: coverage.estimatedSavingsBrl,
      estimatedCostUsd: recommendation?.estimatedUsd ?? 0,
      estimatedCostBrl: recommendation?.estimatedBrl ?? null,
      actualCostUsd: 0,
      actualCostBrl: 0,
      estimatedRemainingCostUsd: recommendation?.estimatedUsd ?? 0,
      estimatedRemainingCostBrl: recommendation?.estimatedBrl ?? null,
      averageCostUsdPerChapter: 0,
      averageInputTokensPerChapter: 0,
      averageOutputTokensPerChapter: 0,
      outputInputRatio: 0,
      averageSecondsPerChapter: 0,
      costPerMinuteUsd: 0,
      elapsedSeconds: 0,
      etaSeconds: null,
      retryCount: 0,
      repairCount: 0,
      failedCount: 0,
      rateLimitCount: 0,
      retryRatePercent: 0,
      repairRatePercent: 0,
      providerStabilityPercent: 100,
      effectiveWorkerCount: request.workerCount,
      telemetryReason: "Aguardando primeiras metricas reais.",
      progressPercent: 0,
      coverageRanges: coverage.ranges
    },
    error: "",
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null
  };
}

function buildMockAutomaticPlan(request: TranslationAutomaticPlanRequest): TranslationAutomaticPlan {
  const samples = [
    { number: request.chapterFrom, reason: "first" },
    { number: Math.floor((request.chapterFrom + request.chapterTo) / 2), reason: "middle" },
    { number: request.chapterTo, reason: "late" }
  ].slice(0, request.maxSamples);
  const candidateModels = (request.candidateModels?.length ? request.candidateModels : [
    "google/gemini-3-flash-preview",
    "gpt-5.4-mini",
    "gpt-4.1-mini",
    "deepseek/deepseek-v4-pro"
  ]).slice(0, request.maxModels);
  const estimate = buildMockTranslationEstimate({
    novelId: request.novelId,
    chapterFrom: 1,
    chapterTo: samples.length,
    mode: request.mode,
    models: candidateModels,
    usdBrlRate: request.usdBrlRate,
    sourceChars: request.sourceChars
      ? Math.max(1, Math.round(request.sourceChars * (samples.length / Math.max(1, request.chapterTo - request.chapterFrom + 1))))
      : undefined
  });
  const estimatedSampleUsd = Number(estimate.recommendations.reduce((total, item) => total + item.estimatedUsd, 0).toFixed(6));
  const graderCount = request.graderModels?.length || 1;
  const pairCount = candidateModels.length * Math.max(0, candidateModels.length - 1) / 2;
  const estimatedEditorialGraderUsd = Number((samples.length * pairCount * graderCount * 0.0024).toFixed(6));
  return {
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    mode: request.mode,
    sampleChapters: samples.map((sample) => ({
      id: `${request.novelId}-${sample.number}`,
      number: sample.number,
      reason: sample.reason,
      sourceChars: request.sourceChars
        ? Math.max(1, Math.round(request.sourceChars / Math.max(1, request.chapterTo - request.chapterFrom + 1)))
        : 11200,
      wordCount: request.sourceChars
        ? Math.max(1, Math.round(request.sourceChars / Math.max(1, request.chapterTo - request.chapterFrom + 1) / 6))
        : 2800
    })),
    candidateModels,
    estimatedSampleUsd,
    estimatedSampleBrl: request.usdBrlRate ? Number((estimatedSampleUsd * request.usdBrlRate).toFixed(6)) : null,
    estimatedEditorialGraderUsd,
    estimatedEditorialGraderBrl: request.usdBrlRate ? Number((estimatedEditorialGraderUsd * request.usdBrlRate).toFixed(6)) : null,
    recommendations: estimate.recommendations
  };
}

export const mockBackendClient: BackendClient = {
  async bootstrap(): Promise<BootstrapPayload> {
    await wait(1250);
    return {
      sources: structuredClone(sources),
      novels: structuredClone(novels),
      queue: structuredClone(queue),
      library: structuredClone(library)
    };
  },

  async searchNovels(filters: Filters): Promise<Novel[]> {
    await jitter(300);
    const query = filters.query.trim().toLowerCase();
    return novels.filter((novel) => {
      const matchesQuery = !query || `${novel.title} ${novel.author}`.toLowerCase().includes(query);
      const matchesSource = filters.sourceId === "all" || novel.sourceId === filters.sourceId;
      const matchesStatus = filters.status === "any" || novel.status === filters.status;
      const matchesLanguage = filters.language === "all" || novel.language.toLowerCase() === filters.language;
      const matchesContent = matchesContentRating(novel, filters.contentRating);
      const matchesTags = matchesTagFilters(novel, filters.includeTags, filters.excludeTags);
      const matchesChapters = novel.chapters >= filters.minChapters && novel.chapters <= filters.maxChapters;
      const matchesUpdated = !filters.updatedOnly || novel.updatedAt === "Hoje" || novel.updatedAt === "Ontem";
      return matchesQuery && matchesSource && matchesStatus && matchesLanguage && matchesContent && matchesTags && matchesChapters && matchesUpdated;
    });
  },

  async getTags(sourceId?: string): Promise<TagCatalogItem[]> {
    await jitter(120);
    if (!sourceId || sourceId === "all") return structuredClone(tagCatalog);
    const scoped = novels.filter((novel) => novel.sourceId === sourceId);
    return buildFallbackTagCatalog(scoped);
  },

  async getNovelChapters(novelId: string): Promise<Chapter[]> {
    await jitter(260);
    const novel = novels.find((item) => item.id === novelId);
    if (!novel) return [];
    const sampleCount = Math.min(8, novel.chapters);
    const firstNumbers = Array.from({ length: sampleCount }, (_, index) => index + 1);
    const tail = novel.chapters > 50 ? [novel.chapters - 2, novel.chapters - 1, novel.chapters] : [];
    return [...firstNumbers, ...tail].map((number) => ({
      id: `${novelId}-${number}`,
      novelId,
      number,
      title: chapterTitle(number),
      pages: 3 + (number % 5),
      sizeMb: Number((0.7 + (number % 6) * 0.28).toFixed(1)),
      downloaded: number % 4 === 0
    }));
  },

  async syncSource(sourceId: string): Promise<SourceSite> {
    const source = sources.find((item) => item.id === sourceId);
    await wait(source?.delayMs ?? 900);
    if (!source) throw new Error("Source not found");
    return {
      ...source,
      status: "online",
      count: source.count + 3,
      lastSync: "Agora"
    };
  },

  async createDownloads(selections: ChapterSelection[]): Promise<QueueItem[]> {
    await wait(650);
    return selections.map((selection, index) => {
      const novel = novels.find((item) => item.id === selection.novelId);
      if (!novel) throw new Error("Novel not found");
      const rangeLabel = selectionLabel(selection, novel.chapters);
      return {
        id: `mock-${Date.now()}-${index}`,
        novelId: novel.id,
        title: novel.title,
        coverClass: novel.coverClass,
        coverUrl: novel.coverUrl,
        bundleKey: novel.bundleKey,
        preset: selection.preset,
        rangeStart: selection.start,
        rangeEnd: selection.end,
        rangeLabel,
        progress: 0,
        state: "queued",
        chaptersTotal: estimateChapters(selection, novel.chapters),
        formats: selection.formats,
        translate: selection.translate,
        audiobook: selection.audiobook
      };
    });
  },

  async validateServer(serverUrl: string, indexMode: IndexMode): Promise<ServerProbe> {
    await wait(540);
    return {
      serverUrl,
      status: "online",
      serverName: defaultServerConfig.serverName,
      version: defaultServerConfig.version,
      latencyMs: modeLatency(indexMode),
      sourceCount: sources.length,
      storageRoot: defaultServerConfig.storageRoot
    };
  },

  async getKindleStatus(): Promise<KindleDeviceStatus> {
    await wait(360);
    return structuredClone(kindleDeviceStatus);
  },

  async sendToKindle(items: QueueItem[]) {
    await wait(680 + items.length * 120);
    return {
      sentIds: items.map((item) => item.id),
      convertedFormat: "AZW3" as const
    };
  },

  async estimateTranslation(request: TranslationEstimateRequest): Promise<TranslationEstimate> {
    await jitter(180);
    return buildMockTranslationEstimate(request);
  },

  async getTranslationCoverage(request: TranslationEstimateRequest): Promise<TranslationCoverage> {
    await jitter(120);
    return buildMockTranslationCoverage(request);
  },

  async createTranslationJob(request: TranslationJobCreateRequest): Promise<TranslationJob> {
    await jitter(220);
    const job = buildMockTranslationJob(request);
    translationJobs.unshift(job);
    return structuredClone(job);
  },

  async listTranslationJobs(): Promise<TranslationJob[]> {
    await jitter(120);
    return structuredClone(translationJobs);
  },

  async runTranslationJob(jobId: string, _allowPaidProviders = false, _allowEditorialGrader = false): Promise<TranslationJob> {
    await jitter(180);
    const job = translationJobs.find((item) => item.id === jobId);
    if (!job) throw new Error("Trabalho de tradução não encontrado");
    return updateMockTranslationJob(jobId, {
      status: "translating",
      startedAt: job.startedAt ?? new Date().toISOString()
    });
  },

  async pauseTranslationJob(jobId: string): Promise<TranslationJob> {
    await jitter(120);
    return updateMockTranslationJob(jobId, { status: "paused" });
  },

  async resumeTranslationJob(jobId: string): Promise<TranslationJob> {
    await jitter(120);
    return updateMockTranslationJob(jobId, { status: "queued" });
  },

  async cancelTranslationJob(jobId: string): Promise<TranslationJob> {
    await jitter(120);
    return updateMockTranslationJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
  },

  async getTranslationAutomaticPlan(request: TranslationAutomaticPlanRequest): Promise<TranslationAutomaticPlan> {
    await jitter(180);
    return buildMockAutomaticPlan(request);
  },

  async getTranslationSelectionHistory(novelId?: string): Promise<TranslationSelectionRecord[]> {
    await jitter(120);
    const records: TranslationSelectionRecord[] = translationJobs
      .filter((job) => job.strategy === "automatic")
      .filter((job) => !novelId || job.novelId === novelId)
      .map((job) => ({
        id: `${job.id}:selection`,
        jobId: job.id,
        novelId: job.novelId,
        chapterFrom: job.chapterFrom,
        chapterTo: job.chapterTo,
        targetLanguage: job.targetLanguage,
        mode: job.mode,
        winnerModel: job.selectedModel === "automatic" ? "google/gemini-3-flash-preview" : job.selectedModel,
        winnerProvider: job.provider === "auto" ? "openrouter" : job.provider,
        editorialGradeCount: job.strategy === "automatic" ? 1 : 0,
        editorialCostUsd: job.strategy === "automatic" ? 0.0024 : 0,
        sampleChapters: [job.chapterFrom, Math.floor((job.chapterFrom + job.chapterTo) / 2), job.chapterTo],
        trials: [],
        createdAt: job.createdAt
      }));
    return structuredClone(records);
  },

  async getTranslationMemory(novelId?: string): Promise<TranslationMemoryTerm[]> {
    await jitter(120);
    const now = new Date().toISOString();
    const terms: TranslationMemoryTerm[] = [
      {
        novelId: novelId ?? "mock-novel-1",
        source: "Gu Master",
        target: "Mestre Gu",
        status: "locked_auto",
        category: "rank_title",
        occurrences: 12,
        firstChapter: 1,
        lastChapter: 7,
        confidence: 0.98,
        notes: "auto known-term extraction",
        updatedAt: now
      },
      {
        novelId: novelId ?? "mock-novel-1",
        source: "primeval essence",
        target: "essencia primeva",
        status: "locked_auto",
        category: "cultivation",
        occurrences: 8,
        firstChapter: 1,
        lastChapter: 5,
        confidence: 0.98,
        notes: "auto known-term extraction",
        updatedAt: now
      }
    ];
    return structuredClone(terms);
  },

  async getTranslationMemoryConflicts(novelId?: string): Promise<TranslationMemoryConflict[]> {
    await jitter(80);
    return [
      {
        novelId: novelId ?? "mock-novel-1",
        conflictType: "same_target_different_source",
        severity: "medium",
        source: "Gu Master",
        target: "Mestre Gu",
        relatedSource: "Gu Cultivator",
        relatedTarget: "Mestre Gu",
        message: "Termos originais diferentes compartilham a mesma tradução."
      }
    ];
  },

  async getTranslationMemoryConflictSuggestions(novelId?: string): Promise<TranslationMemoryConflictSuggestion[]> {
    await jitter(80);
    return [
      {
        novelId: novelId ?? "mock-novel-1",
        conflictType: "near_duplicate_source",
        severity: "low",
        source: "Flower-Wine Monk",
        currentTarget: "Monge Flower Wine",
        suggestedTarget: "Monge do Vinho das Flores",
        relatedSource: "Flower Wine Monk",
        relatedTarget: "Monge do Vinho das Flores",
        confidence: 0.62,
        action: "lock_variant_target",
        reason: "Termos parecem variantes; a sugestao alinha a variante ao termo mais confiavel."
      }
    ];
  },

  async resolveTranslationMemoryConflict(request: TranslationMemoryConflictResolveRequest): Promise<TranslationMemoryConflictResolveResult> {
    await jitter(120);
    return {
      term: {
        novelId: request.novelId,
        source: request.source,
        target: request.target,
        status: "locked",
        category: "manual",
        occurrences: 0,
        firstChapter: null,
        lastChapter: null,
        confidence: 1,
        notes: "Resolvido a partir de alerta do glossario.",
        updatedAt: new Date().toISOString()
      },
      postEdit: request.applyExisting
        ? { scannedCount: 3, changedCount: 1, skippedCount: 0, changedPaths: [] }
        : null,
      remainingConflictCount: 0
    };
  },

  async upsertTranslationMemoryTerm(request: TranslationMemoryTermUpsertRequest): Promise<TranslationMemoryTermUpsertResult> {
    await jitter(120);
    return {
      term: {
        novelId: request.novelId,
        source: request.source,
        target: request.target,
        status: request.status,
        category: request.category,
        occurrences: 0,
        firstChapter: null,
        lastChapter: null,
        confidence: 1,
        notes: request.notes,
        updatedAt: new Date().toISOString()
      },
      postEdit: request.applyExisting
        ? { scannedCount: 3, changedCount: 2, skippedCount: 0, changedPaths: [] }
        : null
    };
  }
};

export const mockBackend = mockBackendClient;

export function defaultFilters(): Filters {
  return {
    query: "",
    sourceId: "all",
    status: "any",
    language: "pt-br",
    contentRating: "all",
    includeTags: [],
    excludeTags: [],
    onlyCovered: false,
    updatedOnly: false,
    minChapters: 1,
    maxChapters: 999999
  };
}

export function defaultSelection(novel: Novel): ChapterSelection {
  return {
    novelId: novel.id,
    preset: "all",
    start: 1,
    end: novel.chapters,
    formats: ["EPUB"],
    translate: false,
    audiobook: false
  };
}

export function selectionLabel(selection: ChapterSelection, max: number) {
  const labels: Record<ChapterPreset, string> = {
    all: `Todos os ${max.toLocaleString("pt-BR")} capítulos`,
    range: `Capítulos ${Math.max(1, selection.start)}-${Math.min(selection.end, max)}`
  };
  return labels[selection.preset];
}

export function estimateChapters(selection: ChapterSelection, max: number) {
  if (selection.preset === "all") return max;
  return Math.max(1, Math.min(selection.end, max) - Math.max(1, selection.start) + 1);
}
