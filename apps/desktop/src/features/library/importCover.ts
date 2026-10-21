import { importEpubStrings } from "../../strings/importEpub";

/** What the typographic cover shows. Without a series, `series` holds the title. */
export type CoverText = { series: string; volume: number | null; subtitle: string };

export type GeneratedCover = { dataUrl: string; bytes: Uint8Array };

// 2:3, like every cover in the app (`Cover`), and the 600px the previews use.
const WIDTH = 600;
const HEIGHT = 900;
const PADDING = 56;

/** Design-system colors, read from the tokens so the cover follows the current theme. */
function tokens() {
  const style = typeof document === "undefined" ? null : getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => style?.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--bg-sidebar", "#1f1f21"),
    accent: read("--accent", "#00796b"),
    accentTint: read("--accent-tint", "#4db6ac"),
    text: read("--text", "#f5f5f7"),
    text2: read("--text-2", "#d1d1d6"),
    font: read("--font-sans", "-apple-system, BlinkMacSystemFont, \"Segoe UI\", system-ui, sans-serif")
  };
}

/** Splits `text` into lines that fit `width`; the last allowed line ends with "…" when cut. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, width: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (!line || ctx.measureText(next).width <= width) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1]}…`;
  while (last.length > 1 && ctx.measureText(last).width > width) last = `${last.slice(0, -2)}…`;
  kept[maxLines - 1] = last;
  return kept;
}

function pngBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Draws the cover the app makes for an imported EPUB with no cover of its own (and no other
 * volume to borrow one from): series name, "Volume N" and the subtitle, on the sidebar gray
 * with a teal rule. Returns null where there is no 2D canvas.
 */
export function drawImportCover({ series, volume, subtitle }: CoverText): GeneratedCover | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext("2d");
  } catch {
    ctx = null;
  }
  if (!ctx) return null;
  const color = tokens();
  const width = WIDTH - PADDING * 2;

  ctx.fillStyle = color.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  // A band of the accent along the spine side, like a cloth binding.
  ctx.fillStyle = color.accent;
  ctx.fillRect(0, 0, 14, HEIGHT);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  let y = PADDING + 44;
  if (volume != null) {
    ctx.font = `600 34px ${color.font}`;
    ctx.fillStyle = color.accentTint;
    ctx.fillText(importEpubStrings.volume(volume), PADDING, y);
    y += 72;
  } else {
    y += 24;
  }

  ctx.font = `700 64px ${color.font}`;
  ctx.fillStyle = color.text;
  for (const line of wrapLines(ctx, series, width, 5)) {
    ctx.fillText(line, PADDING, y);
    y += 74;
  }

  ctx.fillStyle = color.accent;
  ctx.fillRect(PADDING, y - 30, 88, 6);

  if (subtitle.trim()) {
    y += 40;
    ctx.font = `400 36px ${color.font}`;
    ctx.fillStyle = color.text2;
    for (const line of wrapLines(ctx, subtitle, width, 4)) {
      ctx.fillText(line, PADDING, y);
      y += 46;
    }
  }

  const dataUrl = canvas.toDataURL("image/png");
  if (!dataUrl.startsWith("data:image/png")) return null;
  return { dataUrl, bytes: pngBytes(dataUrl) };
}
