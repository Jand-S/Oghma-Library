/**
 * Site icons bundled in `public/sources/` (64×64 PNG), so the app never asks a favicon
 * service at runtime and works offline. Sources without a file get a monogram tile
 * (see `SourceIcon`). Downloaded 2026-09-29 from each site's apple-touch-icon, largest
 * `rel=icon` or `/favicon.ico`, in that order of preference.
 */
const iconFiles: Record<string, string> = {
  "central-novel": "/sources/central-novel.png",
  "golden-novel": "/sources/golden-novel.png",
  "house-saikai": "/sources/house-saikai.png",
  "light-novel-pub": "/sources/light-novel-pub.png",
  "mahou-reader": "/sources/mahou-reader.png",
  "novel-mania": "/sources/novel-mania.png",
  "rolia-scan": "/sources/rolia-scan.png"
  // "sky-demon-order": skydemonorder.com sits behind a Cloudflare challenge; uses the monogram.
};

/** Site domain → source id, for callers that only know a URL. */
const domainIds: Record<string, string> = {
  "centralnovel.com": "central-novel",
  "goldennovel.com": "golden-novel",
  "housesaikai.net": "house-saikai",
  "lightnovelpub.me": "light-novel-pub",
  "mahoureader.com": "mahou-reader",
  "novelmania.com.br": "novel-mania",
  "roliascan.com": "rolia-scan",
  "skydemonorder.com": "sky-demon-order"
};

/** "https://www.centralnovel.com/" → "centralnovel.com". */
export function sourceDomain(baseUrl: string) {
  try {
    return new URL(baseUrl).host.replace(/^www\./, "");
  } catch {
    return baseUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "").replace(/^www\./, "");
  }
}

/**
 * Bundled icon path for a source id ("central-novel", "central_novel"), a domain
 * ("centralnovel.com") or a URL. Returns null when there is no bundled icon.
 */
export function sourceIconPath(idOrDomain: string | null | undefined): string | null {
  if (!idOrDomain) return null;
  const key = idOrDomain.trim().toLowerCase();
  const id = key.replace(/_/g, "-");
  if (iconFiles[id]) return iconFiles[id];
  const domainId = domainIds[sourceDomain(key)];
  return domainId ? iconFiles[domainId] ?? null : null;
}

/** Icon for a source, trying its id first and then its site URL. */
export function sourceIconFor(source: { id?: string | null; baseUrl?: string | null }): string | null {
  return sourceIconPath(source.id) ?? sourceIconPath(source.baseUrl);
}
