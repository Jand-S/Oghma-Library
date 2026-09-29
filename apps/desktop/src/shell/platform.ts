export type Platform = "macos" | "windows" | "linux";

export function detectPlatform(userAgent: string): Platform {
  if (/Mac|iPhone|iPad/i.test(userAgent)) return "macos";
  if (/Win/i.test(userAgent)) return "windows";
  return "linux";
}

/** Platform set on <html data-platform> by main.tsx; tests and browsers without it fall back to "linux". */
export function getPlatform(): Platform {
  if (typeof document === "undefined") return "linux";
  const value = document.documentElement.dataset.platform;
  return value === "macos" || value === "windows" ? value : "linux";
}

/** Writes data-platform on <html> so CSS can key off it. Call before the first render. */
export function applyPlatform(userAgent = navigator.userAgent) {
  const platform = detectPlatform(userAgent);
  document.documentElement.dataset.platform = platform;
  return platform;
}
