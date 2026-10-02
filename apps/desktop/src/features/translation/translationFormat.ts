import { useEffect, useState } from "react";
import type { ProjectStatus } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";

const pad = (value: number) => String(value).padStart(2, "0");

/** "42" or "4,5": one decimal only below 10. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) < 10 && value % 1 !== 0 ? 1 : 0;
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function formatDecimal(value: number, digits = 1): string {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 38200 → "38,2 mil". */
export function formatWords(value: number): string {
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: value >= 100_000 ? 0 : 1 }).format(value);
}

/** 1040 → "1.040", 1_250_000 → "1,3 mi". */
export function formatTokens(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Math.abs(value) < 100_000) return Math.round(value).toLocaleString("pt-BR");
  return new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Plan credits: "0,4", "38", "1.250". */
export function formatCredits(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0 });
}

/** Coarse duration for ETAs: "2h 15min", "12min", "40s". */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return t.etaUnknown;
  const total = Math.max(0, Math.round(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${pad(minutes)}min`;
  if (minutes) return `${minutes}min`;
  return `${total}s`;
}

/** Ticking countdown: "1h 12min 05s", "12min 05s", "45s"; days drop the seconds. */
export function formatCountdown(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days) return `${days}d ${pad(hours)}h ${pad(minutes)}min`;
  if (hours) return `${hours}h ${pad(minutes)}min ${pad(secs)}s`;
  if (minutes) return `${minutes}min ${pad(secs)}s`;
  return `${secs}s`;
}

/** "14:32:05" for a unix-seconds timestamp. */
export function formatClock(unixSec: number): string {
  const date = new Date(unixSec * 1000);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "02/10 14:32" for a unix-seconds timestamp. */
export function formatDateTime(unixSec: number): string {
  const date = new Date(unixSec * 1000);
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export type StatusTone = "neutral" | "accent" | "success" | "warning" | "danger";
export const statusTone: Record<ProjectStatus, StatusTone> = {
  preparing: "neutral",
  ready: "neutral",
  running: "accent",
  paused: "warning",
  waiting_limit: "warning",
  done: "success",
  exported: "success",
  error: "danger"
};

/** True while the runner owns the project (start is not offered). */
export function isActive(status: ProjectStatus) {
  return status === "running" || status === "waiting_limit";
}

/** Current time in unix seconds, re-rendering every `intervalMs` (only the caller re-renders). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const handle = window.setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => window.clearInterval(handle);
  }, [intervalMs]);
  return now;
}
