// Cliente de backend "estatico": le o acervo publicado no B2/CDN
// (index.json -> catalog.json.gz por site -> bundles tar.gz sob demanda).
// Implementa a mesma interface BackendClient usada pela UI, sem SQLite no cliente.
import { sha256Hex } from "./sha256";
import { buildCatalogIndex, searchCatalog, type CatalogIndex } from "./catalogIndex";
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
  TagCatalogItem
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
  sourceChapterCount?: number | null;
  rating?: number | null;
  ratingVotes?: number | null;
  views?: number | null;
  firstSeenAt?: string | null;
  lastChapterAt?: string | null;
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
  /** Published since 2026-10: site URL, dominant catalog language and icon (B2 key). */
  baseUrl?: string | null;
  language?: string | null;
  iconKey?: string | null;
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
  /** The catalog could not be loaded (network, sha mismatch): the source shows as offline. */
  failed?: boolean;
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

async function fetchGzipJson<T>(url: string, sha256?: string | null): Promise<T> {
  // Catalog keys are versioned (timestamp in the name) and published as immutable, so the
  // HTTP cache can keep them between launches; index.json (fetchJson) is never cached.
  const res = await fetch(url, { cache: "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status} ao buscar ${url}`);
  const buf = await res.arrayBuffer();
  // index.json publishes the sha256 of each catalog: a truncated or tampered file is refused.
  if (sha256 && sha256Hex(new Uint8Array(buf)) !== sha256.toLowerCase()) {
    throw new Error(`O catálogo baixado não confere com o índice (sha256): ${url}`);
  }
  const stream = new Response(buf).body;
  if (!stream) throw new Error(`Resposta sem corpo: ${url}`);
  const text = await new Response(stream.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
}

/** Most common language among a catalog's novels ("pt-BR" → "PT-BR"). */
function dominantLanguage(novels: Iterable<CatalogNovel>): string | undefined {
  const counts = new Map<string, number>();
  for (const novel of novels) {
    if (novel.language) counts.set(novel.language, (counts.get(novel.language) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top?.[0];
}

function siteToSource(base: string, site: IndexSite, baseUrl: string, novels?: Iterable<CatalogNovel>, failed = false): SourceSite {
  const language = site.language || (novels ? dominantLanguage(novels) : undefined);
  return {
    id: site.id,
    name: site.name,
    baseUrl,
    count: site.novelCount,
    status: failed ? "offline" : "online",
    enabled: true,
    mode: "api_available",
    lastSync: formatUpdatedAt(site.updatedAt),
    delayMs: 0,
    ...(language ? { language: language.toUpperCase() } : {}),
    ...(site.iconKey ? { iconUrl: `${base}/${site.iconKey}` } : {})
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

export function createStaticBackendClient(serverUrl: string): BackendClient {
  const base = trimBase(serverUrl);
  let sites: SiteCache[] = [];
  let loaded = false;
  let loading: Promise<void> | null = null;
  let index: CatalogIndex = buildCatalogIndex([]);

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
      ...(cn.sourceChapterCount && cn.sourceChapterCount > cn.chapterCount ? { sourceChapters: cn.sourceChapterCount } : {}),
      ...(cn.rating ? { rating: cn.rating } : {}),
      ...(cn.ratingVotes ? { ratingVotes: cn.ratingVotes } : {}),
      ...(cn.views ? { views: cn.views } : {}),
      ...(cn.firstSeenAt ? { firstSeenAt: cn.firstSeenAt } : {}),
      ...(cn.lastChapterAt ? { lastChapterAt: cn.lastChapterAt } : {}),
      language: cn.language || "PT-BR",
      updatedAt: formatUpdatedAt(cn.updatedAt),
      description: cn.description || "",
      coverClass: coverClassFor(cn.id),
      coverUrl: resolveCover(base, cn.coverUrl),
      bundleKey: cn.bundleKey ?? undefined,
      bundleVersion: cn.bundleVersion ?? undefined,
      bundleSha256: cn.bundleSha256 ?? undefined
    };
  }

  function findNovel(novelId: string): { cn: CatalogNovel; source: SiteCache["source"] } | null {
    for (const sc of sites) {
      const cn = sc.novels.get(novelId);
      if (cn) return { cn, source: sc.source };
    }
    return null;
  }

  async function loadSite(site: IndexSite): Promise<SiteCache> {
    const catalog = await fetchGzipJson<CatalogJson>(`${base}/${site.catalogJsonKey}`, site.catalogJsonSha256);
    const novels = new Map<string, CatalogNovel>();
    for (const n of catalog.novels) novels.set(n.id, n);
    const uiNovels = [...novels.values()].map((novel) => novelToUi(novel, catalog.source));
    return {
      site,
      source: catalog.source,
      novels,
      taxonomy: catalog.taxonomy?.length
        ? normalizeTagCatalog(catalog.taxonomy)
        : buildFallbackTagCatalog(uiNovels)
    };
  }

  /**
   * Loads index.json and every catalog in parallel. One failing catalog (network, sha256)
   * only marks that source offline; the others still load. Concurrent callers share the
   * same load. The search index is rebuilt once per load.
   */
  function ensureLoaded(): Promise<void> {
    if (loaded) return Promise.resolve();
    loading ??= (async () => {
      const indexJson = await fetchJson<IndexJson>(`${base}/index.json`);
      const listed = indexJson.sites.filter((site) => site.catalogJsonKey); // catalogo antigo (so sqlite) -> ignora
      const settled = await Promise.allSettled(listed.map(loadSite));
      sites = settled.map((result, i): SiteCache => result.status === "fulfilled"
        ? result.value
        : {
            failed: true,
            site: listed[i],
            source: { id: listed[i].id, name: listed[i].name, baseUrl: listed[i].baseUrl ?? "" },
            novels: new Map(),
            taxonomy: []
          });
      if (listed.length && settled.every((result) => result.status === "rejected")) {
        throw (settled[0] as PromiseRejectedResult).reason;
      }
      index = buildCatalogIndex(allNovels());
      loaded = true;
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  function allNovels(sourceId?: string): Novel[] {
    const out: Novel[] = [];
    for (const sc of sites) {
      if (sourceId && sc.source.id !== sourceId) continue;
      for (const cn of sc.novels.values()) out.push(novelToUi(cn, sc.source));
    }
    return out;
  }

  return {
    async bootstrap(): Promise<BootstrapPayload> {
      await ensureLoaded();
      return {
        sources: sites.map((sc) => siteToSource(base, sc.site, sc.source.baseUrl, sc.novels.values(), sc.failed)),
        // Every loaded novel: the Library enriches its books from the whole catalog.
        novels: index.entries.map((entry) => entry.novel),
        queue: [],
        library: []
      };
    },

    async searchNovels(filters: Filters): Promise<Novel[]> {
      await ensureLoaded();
      return searchCatalog(index, filters, filters.sourceIds);
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

    async getCatalogIndex(): Promise<CatalogIndex> {
      await ensureLoaded();
      return index;
    },

    async listIndexSources(): Promise<SourceSite[]> {
      const index = await fetchJson<IndexJson>(`${base}/index.json`);
      return index.sites.map((site) => siteToSource(base, site, site.baseUrl ?? ""));
    },

    async syncSource(sourceId: string): Promise<SourceSite> {
      loaded = false;
      await ensureLoaded();
      const sc = sites.find((item) => item.site.id === sourceId);
      if (!sc) throw new Error("Fonte não encontrada no índice");
      return siteToSource(base, sc.site, sc.source.baseUrl, sc.novels.values(), sc.failed);
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
          bundleSha256: novel.bundleSha256,
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
    }
  };
}
