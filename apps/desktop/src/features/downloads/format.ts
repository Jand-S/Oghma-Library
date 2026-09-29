import type { DownloadJob } from "../../core/types";
import { formatEta, formatSpeed } from "../../shell/format";
import { downloadsStrings, stageLabels } from "../../strings/downloads";

const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const dayFormat = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

/** 12_900_000 → "12,3 MB" (pt-BR decimal comma, 1024-based units, like formatSpeed). */
export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB"];
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${Math.round(value)} ${units[unit]}` : `${decimal.format(value)} ${units[unit]}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "Hoje, 14:32" / "Ontem, 09:05" / "12 de set., 18:40". */
export function formatFinishedAt(timestamp: number, now = Date.now()) {
  const date = new Date(timestamp);
  const days = Math.round((startOfDay(new Date(now)) - startOfDay(date)) / 86_400_000);
  const day = days === 0 ? downloadsStrings.today : days === 1 ? downloadsStrings.yesterday : dayFormat.format(date);
  return `${day}, ${timeFormat.format(date)}`;
}

/** Chapter range shown under a title. "Todos os N capítulos" is rebuilt so old unaccented labels read right. */
export function describeRange(job: DownloadJob) {
  const { request } = job;
  if (request.preset === "all" && request.chaptersTotal > 0) return downloadsStrings.allChapters(request.chaptersTotal);
  return request.rangeLabel.replace(/\bCapitulos\b/g, "Capítulos").replace(/\bcapitulos\b/g, "capítulos");
}

/** "Baixando · 42% · 1,2 MB/s · 0:35 · Cap. 120/1.234" (progress bar aria-valuetext). */
export function describeJobProgress(job: DownloadJob) {
  const { progress } = job;
  const parts: string[] = [stageLabels[progress.stage] ?? progress.stage, `${Math.round(progress.percent)}%`];
  if (progress.speedBps !== undefined && progress.speedBps > 0) parts.push(formatSpeed(progress.speedBps));
  if (progress.etaSec !== undefined && progress.etaSec > 0) parts.push(formatEta(progress.etaSec));
  if (progress.chaptersTotal) parts.push(`Cap. ${(progress.chaptersDone ?? 0).toLocaleString("pt-BR")}/${progress.chaptersTotal.toLocaleString("pt-BR")}`);
  return parts.join(" · ");
}

/** Files produced for one format, for a badge tooltip. */
export function filesForFormat(job: DownloadJob, format: string) {
  const files = job.outputFiles?.filter((file) => file.toLowerCase().endsWith(`.${format.toLowerCase()}`)) ?? [];
  return files.length > 0 ? files.map((file) => file.split(/[\\/]/).pop()).join(", ") : format;
}
