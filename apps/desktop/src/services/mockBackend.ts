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
  SourceSite
} from "../core/types";
import type { BackendClient } from "./backendClient";

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const jitter = (base = 420) => wait(base + Math.round(Math.random() * 420));

export const mockEndpoints = [
  { method: "GET", path: "/api/bootstrap", description: "Initial app payload" },
  { method: "POST", path: "/api/server/validate", description: "Validate the configured index server and preview its catalog" },
  { method: "GET", path: "/api/sources", description: "Supported sites and sync state" },
  { method: "POST", path: "/api/sources/:id/sync", description: "Start a source metadata sync" },
  { method: "GET", path: "/api/novels", description: "Search novels with filters" },
  { method: "GET", path: "/api/novels/:id/chapters", description: "List sampled chapter metadata" },
  { method: "POST", path: "/api/downloads", description: "Add per-novel chapter selections to queue" },
  { method: "GET", path: "/api/downloads", description: "List active and completed downloads" },
  { method: "GET", path: "/api/library", description: "Local downloaded library" },
  { method: "POST", path: "/api/exports", description: "Generate an export in a chosen format (EPUB, PDF, TXT)" },
  { method: "POST", path: "/api/translations", description: "Queue an AI translation job for selected chapters" },
  { method: "POST", path: "/api/audiobooks", description: "Queue a TTS audiobook job for selected chapters" },
  { method: "GET", path: "/api/devices/kindle/status", description: "Read the USB Kindle connection state" },
  { method: "POST", path: "/api/devices/kindle/send", description: "Convert selected EPUB downloads to AZW3 and transfer them" }
];

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
    tags: ["Misterio", "Drama"],
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
    tags: ["Isekai", "Drama"],
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
    description: "A copia local preservada fica disponivel para conversao e leitura mesmo sem depender do site de origem.",
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
    description: "Uma aventura local com multiplos formatos ja gerados.",
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
    rangeLabel: "Capitulos 1-20",
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
    rangeLabel: "Todos os 2.064 capitulos",
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
    rangeLabel: "Todos os 58 capitulos",
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
    rangeLabel: "Todos os 74 capitulos",
    progress: 100,
    state: "done",
    chaptersTotal: 74,
    formats: ["PDF"],
    translate: false,
    audiobook: false
  }
];

function chapterTitle(index: number) {
  const names = ["O bosque desperta", "Uma carta sem remetente", "O mapa incompleto", "A torre submersa", "Notas do tradutor", "A porta no arquivo"];
  return names[(index - 1) % names.length];
}

function modeLatency(indexMode: IndexMode) {
  if (indexMode === "catalog_only") return 78;
  if (indexMode === "guarded_refresh") return 124;
  return 96;
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
      const matchesTags = filters.tags.length === 0 || filters.tags.every((tag) => novel.tags.includes(tag));
      const matchesChapters = novel.chapters >= filters.minChapters && novel.chapters <= filters.maxChapters;
      const matchesUpdated = !filters.updatedOnly || novel.updatedAt === "Hoje" || novel.updatedAt === "Ontem";
      return matchesQuery && matchesSource && matchesStatus && matchesLanguage && matchesTags && matchesChapters && matchesUpdated;
    });
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
  }
};

export const mockBackend = mockBackendClient;

export function defaultFilters(): Filters {
  return {
    query: "",
    sourceId: "all",
    status: "any",
    language: "pt-br",
    tags: [],
    onlyCovered: true,
    updatedOnly: false,
    minChapters: 1,
    maxChapters: 2500
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
    all: `Todos os ${max.toLocaleString("pt-BR")} capitulos`,
    range: `Capitulos ${Math.max(1, selection.start)}-${Math.min(selection.end, max)}`
  };
  return labels[selection.preset];
}

export function estimateChapters(selection: ChapterSelection, max: number) {
  if (selection.preset === "all") return max;
  return Math.max(1, Math.min(selection.end, max) - Math.max(1, selection.start) + 1);
}
