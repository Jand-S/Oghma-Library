// Cliente de backend "estatico": le o acervo publicado no B2/CDN
// (index.json -> catalog.json.gz por site -> bundles tar.gz sob demanda).
// Implementa a mesma interface BackendClient usada pela UI, sem SQLite no cliente.
import type {
  BootstrapPayload,
  Chapter,
  ChapterPreset,
  ChapterSelection,
  Filters,
  IndexMode,
  KindleDeviceStatus,
  Novel,
  NovelStatus,
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
import type { BackendClient, KindleTransferResult } from "./backendClient";
import { buildFallbackTagCatalog, matchesContentRating, matchesTagFilters, normalizeTagCatalog } from "../core/tagFilters";

// ---- Formatos publicados (espelham backend/src/oghma/publish) ----
type CatalogChapter = { number: number; title: string };

type CatalogNovel = {
  id: string;
  slug: string;
  title: string;
  author: string;
  description: string;
  coverUrl: string | null;
  language: string;
  status: string;
  tags: string[];
  tagKeys?: string[];
  chapterCount: number;
  updatedAt: string | null;
  bundleKey: string | null;
  bundleVersion: number | null;
  bundleSha256: string | null;
  bundleBytes: number | null;
  chapters: CatalogChapter[];
};

type CatalogJson = {
  schema: number;
  taxonomyVersion?: number;
  source: { id: string; name: string; baseUrl: string };
  taxonomy?: TagCatalogItem[];
  novels: CatalogNovel[];
};

type IndexSite = {
  id: string;
  name: string;
  catalogKey: string;
  catalogSha256: string;
  catalogJsonKey?: string;
  catalogJsonSha256?: string;
  catalogVersion: number;
  novelCount: number;
  updatedAt: string;
};

type IndexJson = { schema: number; builtAt: string; sites: IndexSite[] };

type SiteCache = {
  site: IndexSite;
  source: { id: string; name: string; baseUrl: string };
  novels: Map<string, CatalogNovel>;
  taxonomy: TagCatalogItem[];
};

const coverPalette = [
  "cover-c", "cover-d", "cover-e", "cover-f", "cover-g", "cover-h",
  "cover-i", "cover-j", "cover-k", "cover-l", "cover-m", "cover-n"
];

function coverClassFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return coverPalette[hash % coverPalette.length];
}

function mapStatus(raw: string | null): NovelStatus {
  const value = (raw || "").toLowerCase();
  if (value.includes("complet") || value.includes("conclu") || value.includes("finaliz")) return "complete";
  if (value.includes("paus") || value.includes("hiat") || value.includes("droppe")) return "paused";
  return "ongoing";
}

function formatUpdatedAt(raw: string | null): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function trimBase(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, "");
}

function resolveCover(base: string, coverUrl: string | null): string | undefined {
  if (!coverUrl) return undefined;
  if (/^https?:\/\//i.test(coverUrl)) return coverUrl;
  return `${base}/${coverUrl.replace(/^\/+/, "")}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
  return (await res.json()) as T;
}

async function fetchGzipJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
  const buf = await res.arrayBuffer();
  const stream = new Response(buf).body;
  if (!stream) throw new Error(`Resposta sem corpo: ${url}`);
  const text = await new Response(stream.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

function siteToSource(site: IndexSite, baseUrl: string): SourceSite {
  return {
    id: site.id,
    name: site.name,
    baseUrl,
    count: site.novelCount,
    status: "online",
    enabled: true,
    mode: "api_available",
    lastSync: formatUpdatedAt(site.updatedAt),
    delayMs: 0
  };
}

function selectionLabel(selection: ChapterSelection, max: number): string {
  const labels: Record<ChapterPreset, string> = {
    all: `Todos os ${max.toLocaleString("pt-BR")} capítulos`,
    range: `Capítulos ${Math.max(1, selection.start)}-${Math.min(selection.end, max)}`
  };
  return labels[selection.preset];
}

function estimateChapters(selection: ChapterSelection, max: number): number {
  if (selection.preset === "all") return max;
  return Math.max(1, Math.min(selection.end, max) - Math.max(1, selection.start) + 1);
}

function buildStaticTranslationEstimate(request: TranslationEstimateRequest, chapterCount: number): TranslationEstimate {
  const sourceChars = Math.max(chapterCount, request.sourceChars ?? chapterCount * 10400);
  const estimatedSourceTokens = Math.max(1, Math.ceil(sourceChars / 4));
  const estimatedInputTokens = estimatedSourceTokens + chapterCount * 1200;
  const estimatedOutputTokens = Math.round(estimatedSourceTokens * 1.2);
  const equivalentChapterCount = Math.max(chapterCount, sourceChars / 10400);
  const usdBrlRate = request.usdBrlRate ?? null;
  const models = request.models?.length
    ? request.models
    : ["google/gemini-3-flash-preview", "gpt-5.4-mini", "gpt-4.1-mini"];
  const prices: Record<string, { input: number; output: number; quality: number; duration: number; experimental?: boolean }> = {
    "google/gemini-3-flash-preview": { input: 0.5, output: 3, quality: 81.75, duration: 21.83 },
    "gpt-5.4-mini": { input: 0.75, output: 4.5, quality: 79.58, duration: 52 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6, quality: 77.94, duration: 38 },
    "deepseek/deepseek-v4-pro": { input: 0.435, output: 0.87, quality: 77.96, duration: 224.39 },
    "deepseek/deepseek-v4-flash": { input: 0.09, output: 0.18, quality: 79.42, duration: 98.35, experimental: true }
  };
  const recommendations = models.map((model) => {
    const price = prices[model] ?? { input: 0.75, output: 4.5, quality: 70, duration: 60 };
    const estimatedUsd = (estimatedInputTokens / 1_000_000) * price.input + (estimatedOutputTokens / 1_000_000) * price.output;
    return {
      model,
      estimatedUsd: Number(estimatedUsd.toFixed(6)),
      estimatedBrl: usdBrlRate ? Number((estimatedUsd * usdBrlRate).toFixed(6)) : null,
      estimatedDurationSeconds: Number((price.duration * equivalentChapterCount).toFixed(3)),
      qualityScore: price.quality,
      gatePassRate: price.experimental ? 0.5 : 1,
      recommendationScore: Number((price.quality / 100 - estimatedUsd / Math.max(1, chapterCount)).toFixed(6)),
      experimental: Boolean(price.experimental),
      priceTimestamp: new Date().toISOString(),
      notes: price.experimental ? ["Estimativa experimental; requer nova rodada de QA."] : []
    };
  }).sort((a, b) => b.recommendationScore - a.recommendationScore);
  return {
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    chapterCount,
    sourceChars,
    estimatedInputTokens,
    estimatedOutputTokens,
    mode: request.mode,
    recommendations
  };
}

function buildStaticTranslationCoverage(request: TranslationEstimateRequest, chapterCount: number): TranslationCoverage {
  void chapterCount;
  return {
    novelId: request.novelId,
    chapterFrom: request.chapterFrom,
    chapterTo: request.chapterTo,
    targetLanguage: "pt-BR",
    selectedCount: Math.max(1, request.chapterTo - request.chapterFrom + 1),
    translatedCount: 0,
    missingCount: Math.max(1, request.chapterTo - request.chapterFrom + 1),
    staleCount: 0,
    unknownCount: 0,
    coveragePercent: 0,
    ranges: [],
    staleRanges: [],
    unknownRanges: [],
    estimatedSavingsUsd: 0,
    estimatedSavingsBrl: request.usdBrlRate ? 0 : null
  };
}

export function createStaticBackendClient(serverUrl: string): BackendClient {
  const base = trimBase(serverUrl);
  let sites: SiteCache[] = [];
  let loaded = false;

  function novelToUi(cn: CatalogNovel, source: { id: string; name: string }): Novel {
    return {
      id: cn.id,
      title: cn.title,
      author: cn.author || "",
      sourceId: source.id,
      sourceName: source.name,
      tags: cn.tags || [],
      tagKeys: cn.tagKeys || [],
      status: mapStatus(cn.status),
      chapters: cn.chapterCount,
      language: cn.language || "PT-BR",
      updatedAt: formatUpdatedAt(cn.updatedAt),
      description: cn.description || "",
      coverClass: coverClassFor(cn.id),
      coverUrl: resolveCover(base, cn.coverUrl),
      bundleKey: cn.bundleKey ?? undefined,
      bundleVersion: cn.bundleVersion ?? undefined
    };
  }

  function findNovel(novelId: string): { cn: CatalogNovel; source: SiteCache["source"] } | null {
    for (const sc of sites) {
      const cn = sc.novels.get(novelId);
      if (cn) return { cn, source: sc.source };
    }
    return null;
  }

  async function ensureLoaded(): Promise<void> {
    if (loaded) return;
    const index = await fetchJson<IndexJson>(`${base}/index.json`);
    const next: SiteCache[] = [];
    for (const site of index.sites) {
      if (!site.catalogJsonKey) continue; // catalogo antigo (so sqlite) -> ignora no modo estatico
      const catalog = await fetchGzipJson<CatalogJson>(`${base}/${site.catalogJsonKey}`);
      const novels = new Map<string, CatalogNovel>();
      for (const n of catalog.novels) novels.set(n.id, n);
      const uiNovels = [...novels.values()].map((novel) => novelToUi(novel, catalog.source));
      next.push({
        site,
        source: catalog.source,
        novels,
        taxonomy: catalog.taxonomy?.length
          ? normalizeTagCatalog(catalog.taxonomy)
          : buildFallbackTagCatalog(uiNovels)
      });
    }
    sites = next;
    loaded = true;
  }

  function allNovels(sourceId?: string): Novel[] {
    const out: Novel[] = [];
    for (const sc of sites) {
      if (sourceId && sc.source.id !== sourceId) continue;
      for (const cn of sc.novels.values()) out.push(novelToUi(cn, sc.source));
    }
    return out;
  }

  const translationJobs: TranslationJob[] = [];

  function updateTranslationJob(jobId: string, patch: Partial<TranslationJob>): TranslationJob {
    const index = translationJobs.findIndex((job) => job.id === jobId);
    if (index < 0) throw new Error("Trabalho de tradução não encontrado");
    const next = { ...translationJobs[index], ...patch, updatedAt: new Date().toISOString() };
    translationJobs[index] = next;
    return structuredClone(next);
  }

  return {
    async bootstrap(): Promise<BootstrapPayload> {
      await ensureLoaded();
      return {
        sources: sites.map((sc) => siteToSource(sc.site, sc.source.baseUrl)),
        novels: sites[0] ? allNovels(sites[0].source.id) : [],
        queue: [],
        library: []
      };
    },

    async searchNovels(filters: Filters): Promise<Novel[]> {
      await ensureLoaded();
      const query = filters.query.trim().toLowerCase();
      const sourceId = filters.sourceId === "all" ? undefined : filters.sourceId;
      return allNovels(sourceId).filter((novel) => {
        const matchesQuery = !query || `${novel.title} ${novel.author}`.toLowerCase().includes(query);
        const matchesSource = filters.sourceId === "all" || novel.sourceId === filters.sourceId;
        const matchesStatus = filters.status === "any" || novel.status === filters.status;
        const matchesLanguage = filters.language === "all" || novel.language.toLowerCase() === filters.language;
        const matchesContent = matchesContentRating(novel, filters.contentRating);
        const matchesTags = matchesTagFilters(novel, filters.includeTags, filters.excludeTags);
        const matchesChapters = novel.chapters >= filters.minChapters && novel.chapters <= filters.maxChapters;
        return matchesQuery && matchesSource && matchesStatus && matchesLanguage && matchesContent && matchesTags && matchesChapters;
      });
    },

    async getTags(sourceId?: string): Promise<TagCatalogItem[]> {
      await ensureLoaded();
      const scoped = sourceId && sourceId !== "all"
        ? sites.filter((site) => site.source.id === sourceId)
        : sites;
      if (scoped.length === 1) return scoped[0].taxonomy;
      const counts = new Map<string, TagCatalogItem>();
      for (const site of scoped) {
        for (const tag of site.taxonomy) {
          const current = counts.get(tag.key);
          if (!current) {
            counts.set(tag.key, { ...tag });
          } else {
            current.count += tag.count;
            current.aliases = [...new Set([...current.aliases, ...tag.aliases])];
          }
        }
      }
      return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"));
    },

    async getNovelChapters(novelId: string): Promise<Chapter[]> {
      await ensureLoaded();
      const found = findNovel(novelId);
      if (!found) return [];
      const list = [...found.cn.chapters].sort((a, b) => a.number - b.number);
      // Amostra leve para a UI: primeiros 8 + ultimos 3 (a faixa real usa chapterCount).
      const head = list.slice(0, 8);
      const tail = list.length > 50 ? list.slice(-3) : [];
      const sample = [...head, ...tail];
      return sample.map((c) => ({
        id: `${novelId}#${c.number}`,
        novelId,
        number: c.number,
        title: c.title || `Capítulo ${c.number}`,
        pages: 1,
        sizeMb: 0,
        downloaded: false
      }));
    },

    async syncSource(sourceId: string): Promise<SourceSite> {
      loaded = false;
      await ensureLoaded();
      const sc = sites.find((item) => item.site.id === sourceId);
      if (!sc) throw new Error("Fonte não encontrada no índice");
      return siteToSource(sc.site, sc.source.baseUrl);
    },

    async createDownloads(selections: ChapterSelection[]): Promise<QueueItem[]> {
      await ensureLoaded();
      return selections.map((selection, index) => {
        const found = findNovel(selection.novelId);
        if (!found) throw new Error("Novel não encontrada");
        const novel = novelToUi(found.cn, found.source);
        return {
          id: `static-${Date.now()}-${index}`,
          novelId: novel.id,
          title: novel.title,
          coverClass: novel.coverClass,
          coverUrl: novel.coverUrl,
          bundleKey: novel.bundleKey,
          preset: selection.preset,
          rangeStart: selection.start,
          rangeEnd: selection.end,
          rangeLabel: selectionLabel(selection, novel.chapters),
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
      const probeBase = trimBase(serverUrl);
      const started = (globalThis.performance ?? Date).now();
      const index = await fetchJson<IndexJson>(`${probeBase}/index.json`);
      const latencyMs = Math.max(1, Math.round((globalThis.performance ?? Date).now() - started));
      void indexMode;
      return {
        serverUrl,
        status: "online",
        serverName: "Oghma Static (B2/CDN)",
        version: `schema ${index.schema}`,
        latencyMs,
        sourceCount: index.sites.length,
        storageRoot: probeBase
      };
    },

    async getKindleStatus(): Promise<KindleDeviceStatus> {
      return {
        id: "kindle-static",
        deviceName: "Kindle",
        connected: false,
        mountPath: "",
        targetFormat: "AZW3"
      };
    },

    async sendToKindle(items: QueueItem[]): Promise<KindleTransferResult> {
      return { sentIds: items.map((item) => item.id), convertedFormat: "AZW3" };
    },

    async estimateTranslation(request: TranslationEstimateRequest): Promise<TranslationEstimate> {
      await ensureLoaded();
      const found = findNovel(request.novelId);
      const max = found?.cn.chapterCount ?? Math.max(1, request.chapterTo);
      const from = Math.max(1, Math.min(request.chapterFrom, max));
      const to = Math.max(from, Math.min(request.chapterTo, max));
      return buildStaticTranslationEstimate(request, Math.max(1, to - from + 1));
    },

    async getTranslationCoverage(request: TranslationEstimateRequest): Promise<TranslationCoverage> {
      await ensureLoaded();
      const found = findNovel(request.novelId);
      const max = found?.cn.chapterCount ?? Math.max(1, request.chapterTo);
      const from = Math.max(1, Math.min(request.chapterFrom, max));
      const to = Math.max(from, Math.min(request.chapterTo, max));
      return buildStaticTranslationCoverage({ ...request, chapterFrom: from, chapterTo: to }, Math.max(1, to - from + 1));
    },

    async createTranslationJob(request: TranslationJobCreateRequest): Promise<TranslationJob> {
      const coverage = await this.getTranslationCoverage({
        novelId: request.novelId,
        chapterFrom: request.chapterFrom,
        chapterTo: request.chapterTo,
        mode: request.mode,
        usdBrlRate: request.usdBrlRate
      });
      const estimate = await this.estimateTranslation({
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
      const job: TranslationJob = {
        id: `static-translation-${Date.now()}-${translationJobs.length}`,
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
      translationJobs.unshift(job);
      return structuredClone(job);
    },

    async listTranslationJobs(): Promise<TranslationJob[]> {
      return structuredClone(translationJobs);
    },

    async runTranslationJob(jobId: string, _allowPaidProviders = false, _allowEditorialGrader = false): Promise<TranslationJob> {
      const job = translationJobs.find((item) => item.id === jobId);
      if (!job) throw new Error("Trabalho de tradução não encontrado");
      return updateTranslationJob(jobId, {
        status: "translating",
        startedAt: job.startedAt ?? new Date().toISOString()
      });
    },

    async pauseTranslationJob(jobId: string): Promise<TranslationJob> {
      return updateTranslationJob(jobId, { status: "paused" });
    },

    async resumeTranslationJob(jobId: string): Promise<TranslationJob> {
      return updateTranslationJob(jobId, { status: "queued" });
    },

    async cancelTranslationJob(jobId: string): Promise<TranslationJob> {
      return updateTranslationJob(jobId, { status: "cancelled", finishedAt: new Date().toISOString() });
    },

    async getTranslationAutomaticPlan(request: TranslationAutomaticPlanRequest): Promise<TranslationAutomaticPlan> {
      const candidateModels = (request.candidateModels?.length ? request.candidateModels : [
        "google/gemini-3-flash-preview",
        "gpt-5.4-mini",
        "gpt-4.1-mini"
      ]).slice(0, request.maxModels);
      const samples = [
        { number: request.chapterFrom, reason: "first" },
        { number: Math.floor((request.chapterFrom + request.chapterTo) / 2), reason: "middle" },
        { number: request.chapterTo, reason: "late" }
      ].slice(0, request.maxSamples);
      const estimate = await this.estimateTranslation({
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
            : 10400,
          wordCount: request.sourceChars
            ? Math.max(1, Math.round(request.sourceChars / Math.max(1, request.chapterTo - request.chapterFrom + 1) / 6))
            : 2600
        })),
        candidateModels,
        estimatedSampleUsd,
        estimatedSampleBrl: request.usdBrlRate ? Number((estimatedSampleUsd * request.usdBrlRate).toFixed(6)) : null,
        estimatedEditorialGraderUsd,
        estimatedEditorialGraderBrl: request.usdBrlRate ? Number((estimatedEditorialGraderUsd * request.usdBrlRate).toFixed(6)) : null,
        recommendations: estimate.recommendations
      };
    },

    async getTranslationSelectionHistory(novelId?: string): Promise<TranslationSelectionRecord[]> {
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
      const now = new Date().toISOString();
      return [
        {
          novelId: novelId ?? "static-novel",
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
        }
      ];
    },

    async getTranslationMemoryConflicts(novelId?: string): Promise<TranslationMemoryConflict[]> {
      return [
        {
          novelId: novelId ?? "static-novel",
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
      return [
        {
          novelId: novelId ?? "static-novel",
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
          ? { scannedCount: 0, changedCount: 0, skippedCount: 0, changedPaths: [] }
          : null,
        remainingConflictCount: 0
      };
    },

    async upsertTranslationMemoryTerm(request: TranslationMemoryTermUpsertRequest): Promise<TranslationMemoryTermUpsertResult> {
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
          ? { scannedCount: 0, changedCount: 0, skippedCount: 0, changedPaths: [] }
          : null
      };
    }
  };
}
