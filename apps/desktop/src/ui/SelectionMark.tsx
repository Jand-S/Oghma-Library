import { Check } from "lucide-react";
import { cx } from "./cx";
import "./SelectionMark.css";

/**
 * The round accent check drawn on a selected cover (Buscar, Kindle). Place it inside a
 * `position: relative` box; it sits in the top-right corner and is hidden from screen
 * readers, so the card's own control carries the selected state.
 */
export function SelectionMark({ className }: { className?: string }) {
  return (
    <span className={cx("o-selection-mark", className)} aria-hidden="true">
      <Check />
    </span>
  );
}
