import type { ComponentPropsWithRef, ReactNode } from "react";
import { cx } from "./cx";
import { Spinner } from "./Spinner";
import "./Button.css";

export type ButtonVariant = "primary" | "outline" | "ghost" | "danger" | "glass";
export type ButtonSize = "sm" | "md" | "lg";

export type ButtonProps = ComponentPropsWithRef<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (e.g. a lucide icon element). */
  icon?: ReactNode;
  iconRight?: ReactNode;
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
  /** Stretches the button to the container width. */
  block?: boolean;
};

export function Button({
  variant = "outline",
  size = "md",
  icon,
  iconRight,
  loading = false,
  block = false,
  disabled,
  className,
  children,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={cx("o-button", `o-button--${variant}`, `o-button--${size}`, block && "o-button--block", loading && "is-loading", className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Spinner size="sm" /> : icon ? <span className="o-button__icon" aria-hidden="true">{icon}</span> : null}
      {children != null ? <span className="o-button__label">{children}</span> : null}
      {iconRight && !loading ? <span className="o-button__icon" aria-hidden="true">{iconRight}</span> : null}
    </button>
  );
}
