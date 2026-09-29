import type { ComponentPropsWithoutRef } from "react";
import { cx } from "./cx";
import "./Badge.css";

export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

export type BadgeProps = ComponentPropsWithoutRef<"span"> & {
  tone?: BadgeTone;
};

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return <span {...rest} className={cx("o-badge", `o-badge--${tone}`, className)} />;
}
