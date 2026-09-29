import { useSyncExternalStore } from "react";
import { sourcesStrings } from "../../strings/sources";

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

const DAY_MS = 86_400_000;

function parseSyncDate(raw: string): { date: Date; dateOnly: boolean } | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return { date: new Date(Number(year), Number(month) - 1, Number(day)), dateOnly: true };
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw)) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : { date, dateOnly: false };
}

/**
 * A source's `lastSync` as relative time ("há 2 dias") plus the exact date for a tooltip.
 * ISO dates ("2026-09-04", "2026-09-04T01:20:33Z") become relative; any other text
 * ("Agora", "Hoje, 01:14") is already human and passes through.
 */
export function formatRelativeSync(raw: string, now = new Date()): { label: string; title?: string } {
  const value = raw.trim();
  if (!value) return { label: "—" };
  const parsed = parseSyncDate(value);
  if (!parsed) return { label: value };
  const { date, dateOnly } = parsed;
  const title = dateOnly
    ? date.toLocaleDateString("pt-BR")
    : `${date.toLocaleDateString("pt-BR")}, ${date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  const startOfDay = (at: Date) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();
  const days = Math.max(0, Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS));
  const relative = sourcesStrings.relative;
  if (days === 0) {
    if (dateOnly) return { label: relative.today, title };
    const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
    if (minutes < 1) return { label: relative.now, title };
    if (minutes < 60) return { label: relative.minutes(minutes), title };
    return { label: relative.hours(Math.floor(minutes / 60)), title };
  }
  if (days === 1) return { label: relative.yesterday, title };
  if (days < 30) return { label: relative.days(days), title };
  if (days < 365) return { label: relative.months(Math.floor(days / 30)), title };
  return { label: relative.years(Math.floor(days / 365)), title };
}
