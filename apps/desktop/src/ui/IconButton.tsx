import type { ComponentPropsWithRef, ReactNode } from "react";
import type { ButtonSize, ButtonVariant } from "./Button";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import "./IconButton.css";

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "children"> & {
  /** Required accessible name; also used as the tooltip. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  /** Hides the native tooltip (e.g. when a visible label sits next to it). */
  noTooltip?: boolean;
};

export function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  loading = false,
  noTooltip = false,
  disabled,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      aria-label={label}
      title={noTooltip ? undefined : label}
      className={cx("o-icon-button", `o-icon-button--${variant}`, `o-icon-button--${size}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner size="sm" /> : <span className="o-icon-button__icon" aria-hidden="true">{icon}</span>}
    </button>
  );
}
