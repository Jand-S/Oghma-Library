import { X } from "lucide-react";
import type { ReactNode } from "react";
import { uiStrings } from "../strings/common";
import { cx } from "./cx";
import "./Chip.css";

export type ChipTone = "neutral" | "accent" | "danger" | "warning" | "success";

export type ChipProps = {
  children: ReactNode;
  /** Toggle state; rendered as aria-pressed when `onToggle` is set. */
  selected?: boolean;
  onToggle?: () => void;
  /** Shows a remove button. `removeLabel` defaults to "Remover {children}" for string children. */
  onRemove?: () => void;
  removeLabel?: string;
  tone?: ChipTone;
  icon?: ReactNode;
  disabled?: boolean;
  className?: string;
};

export function Chip({ children, selected, onToggle, onRemove, removeLabel, tone = "neutral", icon, disabled, className }: ChipProps) {
  const classes = cx("o-chip", `o-chip--${tone}`, selected && "is-selected", className);
  const content = (
    <>
      {icon ? <span className="o-chip__icon" aria-hidden="true">{icon}</span> : null}
      <span className="o-chip__label">{children}</span>
    </>
  );
  const remove = onRemove ? (
    <button
      type="button"
      className="o-chip__remove"
      aria-label={removeLabel ?? uiStrings.remove(typeof children === "string" ? children : "")}
      onClick={onRemove}
      disabled={disabled}
    >
      <X aria-hidden="true" />
    </button>
  ) : null;

  if (onToggle) {
    return (
      <span className={cx(classes, "o-chip--interactive")}>
        <button type="button" className="o-chip__toggle" aria-pressed={Boolean(selected)} onClick={onToggle} disabled={disabled}>
          {content}
        </button>
        {remove}
      </span>
    );
  }
  return (
    <span className={classes}>
      {content}
      {remove}
    </span>
  );
}
