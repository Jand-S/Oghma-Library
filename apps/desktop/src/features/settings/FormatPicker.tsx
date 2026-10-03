import { useId, type ReactNode } from "react";
import type { DownloadFormat } from "../../core/types";
import { offeredFormats } from "../../core/types";
import { Chip, cx } from "../../ui";
import "./settings.css";

const formatLabels: Record<DownloadFormat, string> = {
  EPUB: "EPUB",
  PDF: "PDF",
  TXT: "TXT",
  AZW3: "AZW3 (Kindle)"
};

/** Toggles `format` in `current`, keeping the canonical order and at least one format. */
export function toggleFormat(current: readonly DownloadFormat[], format: DownloadFormat): DownloadFormat[] {
  const has = current.includes(format);
  if (has && current.length === 1) return [...current];
  return has
    ? current.filter((item) => item !== format)
    : offeredFormats.filter((item) => current.includes(item) || item === format);
}

/**
 * Default download formats as toggle chips. Shared by Ajustes and the onboarding.
 * The last selected format cannot be turned off.
 */
export function FormatPicker({
  label,
  hint,
  value,
  onChange,
  hideLabel = false,
  className
}: {
  label: string;
  hint?: ReactNode;
  value: readonly DownloadFormat[];
  onChange: (formats: DownloadFormat[]) => void;
  hideLabel?: boolean;
  className?: string;
}) {
  const hintId = useId();
  return (
    <fieldset className={cx("settings-formats", className)} aria-describedby={hint ? hintId : undefined} data-testid="format-picker">
      <legend className={cx("settings-formats__legend", hideLabel && "sr-only")}>{label}</legend>
      <div className="settings-formats__chips">
        {offeredFormats.map((format) => (
          <Chip
            key={format}
            selected={value.includes(format)}
            tone={value.includes(format) ? "accent" : "neutral"}
            onToggle={() => {
              const next = toggleFormat(value, format);
              if (next.length !== value.length) onChange(next);
            }}
          >
            {formatLabels[format]}
          </Chip>
        ))}
      </div>
      {hint ? <p className="settings-formats__hint" id={hintId}>{hint}</p> : null}
    </fieldset>
  );
}
