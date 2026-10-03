import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";
import type { Filters } from "../core/types";
import { sha256Hex } from "../services/sha256";
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

let tamperCatalog = false;

beforeEach(() => {
  tamperCatalog = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown) => {
      const u = String(url);
      // The same gzip bytes back both the index sha256 and the catalog response.
      const catalogGz = new Uint8Array(await gzip(JSON.stringify(catalogJson)));
      if (u.endsWith("/index.json")) {
        const sites = indexJson.sites.map((site) => ({ ...site, catalogJsonSha256: sha256Hex(catalogGz) }));
        return new Response(JSON.stringify({ ...indexJson, sites }), { status: 200 });
      }
      if (u.endsWith("/catalog/x.json.gz")) {
        if (tamperCatalog) catalogGz[catalogGz.length - 1] ^= 0xff;
        return new Response(catalogGz, { status: 200 });
      }
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

  it("sources carry the catalog language and the icon published in the index", async () => {
    const client = createStaticBackendClient(BASE);
    const [source] = (await client.bootstrap()).sources;
    expect(source.language).toBe("PT-BR");
    expect(source.iconUrl).toBeUndefined();

    indexJson.sites[0] = { ...indexJson.sites[0], language: "en", iconKey: "sources/central-novel-abc.png", baseUrl: "https://centralnovel.com/" } as typeof indexJson.sites[0];
    try {
      const [peek] = await client.listIndexSources!();
      expect(peek).toMatchObject({ id: "central-novel", language: "EN", count: 1, baseUrl: "https://centralnovel.com/",
        iconUrl: `${BASE}/sources/central-novel-abc.png` });
    } finally {
      const { language: _l, iconKey: _i, baseUrl: _b, ...plain } = indexJson.sites[0] as Record<string, unknown>;
      indexJson.sites[0] = plain as typeof indexJson.sites[0];
    }
  });

  it("a novel still being collected keeps the chapter count the site announces", async () => {
    const novel = catalogJson.novels[0] as Record<string, unknown>;
    novel.sourceChapterCount = 967;
    try {
      const [n] = (await createStaticBackendClient(BASE).bootstrap()).novels;
      expect(n.chapters).toBe(2);
      expect(n.sourceChapters).toBe(967);
    } finally {
      delete novel.sourceChapterCount;
    }
    const [complete] = (await createStaticBackendClient(BASE).bootstrap()).novels;
    expect(complete.sourceChapters).toBeUndefined();
  });

  it("one catalog that fails to load marks only that source offline", async () => {
    const broken = { ...indexJson.sites[0], id: "broken-source", name: "Fonte Quebrada", catalogJsonKey: "catalog/missing.json.gz" };
    indexJson.sites.push(broken);
    try {
      const boot = await createStaticBackendClient(BASE).bootstrap();
      expect(boot.sources.map((s) => [s.id, s.status])).toEqual([["central-novel", "online"], ["broken-source", "offline"]]);
      expect(boot.novels.map((n) => n.id)).toEqual(["central-novel:lord"]);
    } finally {
      indexJson.sites.pop();
    }
  });

  it("concurrent calls share one load", async () => {
    const client = createStaticBackendClient(BASE);
    await Promise.all([client.bootstrap(), client.searchNovels(emptyFilters()), client.getTags()]);
    const urls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.endsWith("/index.json"))).toHaveLength(1);
  });

  it("a catalog that does not match the index sha256 is refused", async () => {
    tamperCatalog = true;
    await expect(createStaticBackendClient(BASE).bootstrap()).rejects.toThrow("não confere com o índice");
  });

  it("maps the normalized rating, views and dates of the catalog", async () => {
    const raw = catalogJson.novels[0] as Record<string, unknown>;
    Object.assign(raw, { rating: 4.36, ratingVotes: 128, views: 900, lastChapterAt: "2026-10-03T20:21:00+00:00" });
    try {
      const [n] = (await createStaticBackendClient(BASE).bootstrap()).novels;
      expect(n).toMatchObject({ rating: 4.36, ratingVotes: 128, views: 900, lastChapterAt: "2026-10-03T20:21:00+00:00" });
    } finally {
      for (const key of ["rating", "ratingVotes", "views", "lastChapterAt"]) delete raw[key];
    }
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
});
