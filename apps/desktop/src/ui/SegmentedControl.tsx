import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx";
import "./SegmentedControl.css";

export type SegmentedOption<T extends string> = { value: T; label: ReactNode; icon?: ReactNode; disabled?: boolean };

export type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  size?: "sm" | "md";
  className?: string;
};

/** Single-choice toggle group (radio semantics, roving tabindex, arrow keys). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
  "aria-label": ariaLabel
}: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!delta && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const currentIndex = enabled.findIndex((option) => option.value === value);
    let nextIndex = currentIndex + delta;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = enabled.length - 1;
    const next = enabled[(nextIndex + enabled.length) % enabled.length];
    if (!next) return;
    onChange(next.value);
    refs.current[options.indexOf(next)]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx("o-segmented", `o-segmented--${size}`, className)} onKeyDown={onKeyDown}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            className={cx("o-segmented__option", checked && "is-selected")}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className="o-segmented__icon" aria-hidden="true">{option.icon}</span> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
