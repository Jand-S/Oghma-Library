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
  SourceSite
} from "../core/types";
import type { BackendClient, KindleTransferResult } from "./backendClient";

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
  source: { id: string; name: string; baseUrl: string };
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
    all: `Todos os ${max.toLocaleString("pt-BR")} capitulos`,
    range: `Capitulos ${Math.max(1, selection.start)}-${Math.min(selection.end, max)}`
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

  function novelToUi(cn: CatalogNovel, source: { id: string; name: string }): Novel {
    return {
      id: cn.id,
      title: cn.title,
      author: cn.author || "",
      sourceId: source.id,
      sourceName: source.name,
      tags: cn.tags || [],
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
      next.push({ site, source: catalog.source, novels });
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
        const matchesTags = filters.tags.length === 0 || filters.tags.every((tag) => novel.tags.includes(tag));
        const matchesChapters = novel.chapters >= filters.minChapters && novel.chapters <= filters.maxChapters;
        return matchesQuery && matchesSource && matchesStatus && matchesLanguage && matchesTags && matchesChapters;
      });
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
        title: c.title || `Capitulo ${c.number}`,
        pages: 1,
        sizeMb: 0,
        downloaded: false
      }));
    },

    async syncSource(sourceId: string): Promise<SourceSite> {
      loaded = false;
      await ensureLoaded();
      const sc = sites.find((item) => item.site.id === sourceId);
      if (!sc) throw new Error("Fonte nao encontrada no index");
      return siteToSource(sc.site, sc.source.baseUrl);
    },

    async createDownloads(selections: ChapterSelection[]): Promise<QueueItem[]> {
      await ensureLoaded();
      return selections.map((selection, index) => {
        const found = findNovel(selection.novelId);
        if (!found) throw new Error("Novel nao encontrada");
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
    }
  };
}
