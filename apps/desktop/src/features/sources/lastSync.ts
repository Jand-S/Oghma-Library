import { useSyncExternalStore } from "react";

/**
 * Time of the last successful index sync done by this app (any source), in ms.
 * Backed by localStorage and shared by Fontes, Ajustes and the onboarding sync.
 */
const LAST_SYNC_KEY = "oghma.sources.lastSync";
const listeners = new Set<() => void>();

export function readLastSync(): number | null {
  try {
    const value = Number(window.localStorage.getItem(LAST_SYNC_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

export function markSourcesSynced(at = Date.now()) {
  try {
    window.localStorage.setItem(LAST_SYNC_KEY, String(at));
  } catch {
    // Storage unavailable: the time is not remembered across launches.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useLastSync() {
  return useSyncExternalStore(subscribe, readLastSync, readLastSync);
}

/** "Hoje, 14:32", "Ontem, 09:10" or "12/09/2026, 18:05". */
export function formatSyncTime(at: number, now = new Date()): string {
  const date = new Date(at);
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000);
  if (days === 0) return `Hoje, ${time}`;
  if (days === 1) return `Ontem, ${time}`;
  return `${date.toLocaleDateString("pt-BR")}, ${time}`;
}
