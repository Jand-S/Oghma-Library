import { Star } from "lucide-react";
import { useRef, useState, type KeyboardEvent } from "react";
import { uiStrings } from "../strings/common";
import { cx } from "./cx";
import "./StarRating.css";

export type StarRatingProps = {
  /** 1–5; null/undefined = not rated. */
  value?: number | null;
  /** Makes it a control: picking the current value again clears it (null). */
  onChange?: (value: number | null) => void;
  /** Accessible name of the control ("Sua nota"). */
  label?: string;
  size?: "xs" | "sm" | "md";
  /** Read-only: hide the empty stars (a card shows only what was rated). */
  compact?: boolean;
  className?: string;
};

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Five stars. Read-only by default (`role="img"`); with `onChange` it is a radio group:
 * click or arrows to rate, the same star again (or Backspace) to clear, hover previews.
 */
export function StarRating({ value, onChange, label = uiStrings.rating, size = "sm", compact, className }: StarRatingProps) {
  const [hover, setHover] = useState<number | null>(null);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = value && value >= 1 && value <= 5 ? Math.round(value) : 0;

  if (!onChange) {
    if (compact && !current) return null;
    const shown = compact ? STARS.slice(0, current) : STARS;
    return (
      <span className={cx("o-stars", `o-stars--${size}`, className)} role="img" aria-label={current ? uiStrings.ratingValue(current) : uiStrings.notRated}>
        {shown.map((star) => (
          <Star key={star} aria-hidden="true" className={cx("o-stars__star", star <= current && "is-on")} />
        ))}
      </span>
    );
  }

  const shownValue = hover ?? current;
  const pick = (star: number) => onChange(star === current ? null : star);
  const focusStar = (star: number) => refs.current[star - 1]?.focus();
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, star: number) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.min(5, star + 1);
      onChange(next);
      focusStar(next);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.max(1, star - 1);
      onChange(next);
      focusStar(next);
    } else if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      event.preventDefault();
      onChange(null);
    }
  };

  return (
    <span
      className={cx("o-stars", "o-stars--interactive", `o-stars--${size}`, className)}
      role="radiogroup"
      aria-label={label}
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((star) => (
        <button
          key={star}
          ref={(node) => {
            refs.current[star - 1] = node;
          }}
          type="button"
          role="radio"
          aria-checked={star === current}
          aria-label={uiStrings.rateStars(star)}
          // Roving tab stop: the rated star (or the first) is the one Tab lands on.
          tabIndex={star === (current || 1) ? 0 : -1}
          className={cx("o-stars__button", star <= shownValue && "is-on", hover != null && star <= hover && "is-preview")}
          onMouseEnter={() => setHover(star)}
          onFocus={() => setHover(null)}
          onClick={() => pick(star)}
          onKeyDown={(event) => onKeyDown(event, star)}
        >
          <Star aria-hidden="true" className="o-stars__star" />
        </button>
      ))}
    </span>
  );
}
