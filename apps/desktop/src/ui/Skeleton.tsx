import type { CSSProperties } from "react";
import { cx } from "./cx";
import "./Skeleton.css";

export type SkeletonProps = {
  /** CSS length or number of pixels. */
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
};

const toLength = (value: number | string | undefined) => (typeof value === "number" ? `${value}px` : value);

export function Skeleton({ width = "100%", height = "1em", radius, className }: SkeletonProps) {
  const style: CSSProperties = { width: toLength(width), height: toLength(height), borderRadius: toLength(radius) };
  return <span className={cx("o-skeleton", className)} style={style} aria-hidden="true" />;
}
