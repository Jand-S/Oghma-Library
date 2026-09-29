import { cx } from "./cx";
import "./ProgressBar.css";

export type ProgressBarProps = {
  value?: number;
  max?: number;
  size?: "sm" | "md";
  indeterminate?: boolean;
  /** Accessible name of the progress bar. */
  label: string;
  /** Optional human text, e.g. "42% · 1,2 MB/s", exposed as aria-valuetext. */
  valueText?: string;
  tone?: "accent" | "success" | "danger";
  className?: string;
};

export function ProgressBar({
  value = 0,
  max = 100,
  size = "md",
  indeterminate = false,
  label,
  valueText,
  tone = "accent",
  className
}: ProgressBarProps) {
  const safeMax = max > 0 ? max : 100;
  const clamped = Math.min(Math.max(value, 0), safeMax);
  const ratio = clamped / safeMax;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={indeterminate ? undefined : Math.round(clamped)}
      aria-valuetext={indeterminate ? undefined : valueText}
      aria-busy={indeterminate || undefined}
      className={cx("o-progress", `o-progress--${size}`, `o-progress--${tone}`, indeterminate && "o-progress--indeterminate", className)}
    >
      <span className="o-progress__bar" style={indeterminate ? undefined : { transform: `scaleX(${ratio})` }} />
    </div>
  );
}
