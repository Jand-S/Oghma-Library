import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { Filters } from "../core/types";
import { createStaticBackendClient } from "../services/staticBackend";

const BASE = "https://b2.example";

const indexJson = {
  schema: 1,
  builtAt: "2026-06-16T00:00:00Z",
  sites: [
    {
      id: "central-novel",
      name: "Central Novel",
      catalogKey: "catalog/x.sqlite.gz",
      catalogSha256: "a",
      catalogJsonKey: "catalog/x.json.gz",
      catalogJsonSha256: "b",
      catalogVersion: 1,
      novelCount: 1,
      updatedAt: "2026-06-16T00:00:00Z"
    }
  ]
};

const catalogJson = {
  schema: 1,
  source: { id: "central-novel", name: "Central Novel", baseUrl: "https://centralnovel.com/" },
  novels: [
    {
      id: "central-novel:lord",
      slug: "lord",
      title: "Lord of Mysteries",
      author: "Cuttlefish",
      description: "d",
      coverUrl: "covers/central-novel/lord.png",
      language: "PT-BR",
      status: "ongoing",
      tags: ["Fantasia"],
      tagKeys: ["genre.fantasy"],
      chapterCount: 2,
      updatedAt: "2026-06-10T00:00:00Z",
      bundleKey: "content/central-novel/lord/lord.v1.tar.gz",
      bundleVersion: 1,
      bundleSha256: "s",
      bundleBytes: 100,
      chapters: [
        { number: 1, title: "C1" },
        { number: 2, title: "C2" }
      ]
    }
  ]
};

async function gzip(text: string): Promise<ArrayBuffer> {
  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  void writer.write(new TextEncoder().encode(text));
  void writer.close();
  return new Response(cs.readable).arrayBuffer();
}

function emptyFilters(over: Partial<Filters> = {}): Filters {
  return {
    query: "",
    sourceId: "all",
    status: "any",
    language: "all",
    contentRating: "all",
    includeTags: [],
    excludeTags: [],
    onlyCovered: false,
    updatedOnly: false,
    minChapters: 0,
    maxChapters: 99999,
    ...over
  };
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.endsWith("/index.json")) return new Response(JSON.stringify(indexJson), { status: 200 });
      if (u.endsWith("/catalog/x.json.gz")) return new Response(await gzip(JSON.stringify(catalogJson)), { status: 200 });
      return new Response("not found", { status: 404 });
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staticBackend", () => {
  it("bootstrap maps index + catalog to UI types", async () => {
    const client = createStaticBackendClient(BASE);
    const boot = await client.bootstrap();
    expect(boot.sources).toHaveLength(1);
    expect(boot.sources[0].id).toBe("central-novel");
    expect(boot.novels).toHaveLength(1);
    const n = boot.novels[0];
    expect(n.title).toBe("Lord of Mysteries");
    expect(n.chapters).toBe(2);
    expect(n.coverUrl).toBe(`${BASE}/covers/central-novel/lord.png`);
    expect(n.status).toBe("ongoing");
    expect(boot.queue).toEqual([]);
  });

  it("searchNovels filters by query", async () => {
    const client = createStaticBackendClient(BASE);
    expect(await client.searchNovels(emptyFilters())).toHaveLength(1);
    expect(await client.searchNovels(emptyFilters({ query: "zzz" }))).toHaveLength(0);
  });

  it("getNovelChapters returns the chapter list", async () => {
    const client = createStaticBackendClient(BASE);
    await client.bootstrap();
    const chs = await client.getNovelChapters("central-novel:lord");
    expect(chs.map((c) => c.number)).toEqual([1, 2]);
    expect(chs[0].title).toBe("C1");
  });

  it("validateServer reports the site count", async () => {
    const client = createStaticBackendClient(BASE);
    const probe = await client.validateServer(BASE, "catalog_only");
    expect(probe.sourceCount).toBe(1);
    expect(probe.status).toBe("online");
  });

  it("createDownloads builds queue items from a selection", async () => {
    const client = createStaticBackendClient(BASE);
    await client.bootstrap();
    const items = await client.createDownloads([
      { novelId: "central-novel:lord", preset: "all", start: 1, end: 2, formats: ["EPUB"], translate: false, audiobook: false }
    ]);
    expect(items).toHaveLength(1);
    expect(items[0].chaptersTotal).toBe(2);
    expect(items[0].state).toBe("queued");
    expect(items[0].bundleKey).toBe("content/central-novel/lord/lord.v1.tar.gz");
    expect(items[0].coverUrl).toBe(`${BASE}/covers/central-novel/lord.png`);
    expect(items[0].rangeStart).toBe(1);
    expect(items[0].rangeEnd).toBe(2);
  });

  it("scales translation estimates using measured local content", async () => {
    const client = createStaticBackendClient(BASE);
    const base = {
      novelId: "local-book",
      chapterFrom: 1,
      chapterTo: 100,
      mode: "balanced" as const,
      models: ["gpt-4.1-mini"],
      usdBrlRate: 5.5
    };

    const small = await client.estimateTranslation({ ...base, sourceChars: 1_000_000 });
    const large = await client.estimateTranslation({ ...base, sourceChars: 11_000_000 });

    expect(large.estimatedInputTokens).toBeGreaterThan(small.estimatedInputTokens * 7);
    expect(large.recommendations[0].estimatedBrl ?? 0).toBeGreaterThan(
      (small.recommendations[0].estimatedBrl ?? 0) * 7
    );
  });
});
