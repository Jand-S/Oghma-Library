import { LoaderCircle } from "lucide-react";
import { cx } from "./cx";
import "./Spinner.css";

export type SpinnerProps = {
  size?: "sm" | "md" | "lg";
  /** Accessible label; omit when the surrounding control already says it is busy. */
  label?: string;
  className?: string;
};

export function Spinner({ size = "md", label, className }: SpinnerProps) {
  return (
    <span
      className={cx("o-spinner", `o-spinner--${size}`, className)}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <LoaderCircle aria-hidden="true" />
    </span>
  );
}
