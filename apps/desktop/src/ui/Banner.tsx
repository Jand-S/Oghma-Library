import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cx } from "./cx";
import "./Banner.css";

export type BannerTone = "info" | "warning" | "danger" | "success";

export type BannerProps = {
  tone?: BannerTone;
  /** Overrides the tone's default icon; pass null for none. */
  icon?: ReactNode | null;
  title?: ReactNode;
  children?: ReactNode;
  /** Buttons on the trailing edge. */
  actions?: ReactNode;
  className?: string;
  role?: "status" | "alert";
  "data-testid"?: string;
};

const ICONS: Record<BannerTone, ReactNode> = {
  info: <Info />,
  warning: <AlertTriangle />,
  danger: <XCircle />,
  success: <CheckCircle2 />
};

/** Inline notice with a status tone: limits, warnings, results. */
export function Banner({ tone = "info", icon, title, children, actions, className, role = "status", ...rest }: BannerProps) {
  const glyph = icon === undefined ? ICONS[tone] : icon;
  return (
    <div className={cx("o-banner", `o-banner--${tone}`, className)} role={role} data-testid={rest["data-testid"]}>
      {glyph ? <span className="o-banner__icon" aria-hidden="true">{glyph}</span> : null}
      <div className="o-banner__body">
        {title ? <strong className="o-banner__title">{title}</strong> : null}
        {children ? <div className="o-banner__text">{children}</div> : null}
      </div>
      {actions ? <div className="o-banner__actions">{actions}</div> : null}
    </div>
  );
}
