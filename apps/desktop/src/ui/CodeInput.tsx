import { useEffect, useRef, type ClipboardEvent, type KeyboardEvent } from "react";
import { cx } from "./cx";
import "./CodeInput.css";

export type CodeInputProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are filled (typing or pasting). */
  onComplete?: (value: string) => void;
  length?: number;
  /** Accessible name of the group ("Código de 6 dígitos"). */
  label: string;
  /** Accessible name of each box ("Dígito 2 de 6"). */
  digitLabel: (index: number) => string;
  invalid?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
};

/**
 * One-time code boxes, like Apple's verification: each digit in its own box, focus moves
 * forward as you type and back on Backspace, and pasting the whole code fills every box.
 */
export function CodeInput({ value, onChange, onComplete, length = 6, label, digitLabel, invalid, disabled, autoFocus }: CodeInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, index) => value[index] ?? "");

  useEffect(() => {
    if (autoFocus) refs.current[Math.min(value.length, length - 1)]?.focus();
    // Only when it mounts (or comes back enabled after a wrong code).
  }, [autoFocus, disabled]);

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const setDigit = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, "");
    if (!typed) return;
    if (typed.length > 1) {
      // Autofill or a fast paste into one box: spread from here.
      const clean = commit(value.slice(0, index) + typed);
      refs.current[Math.min(clean.length, length - 1)]?.focus();
      return;
    }
    const chars = digits.slice();
    chars[index] = typed;
    const clean = commit(chars.join("").slice(0, Math.max(index + 1, value.length)));
    refs.current[Math.min(index + 1, length - 1)]?.focus();
    if (clean.length === length) refs.current[length - 1]?.blur();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>, index: number) => {
    if (event.key === "Backspace") {
      event.preventDefault();
      if (digits[index]) {
        commit(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        commit(value.slice(0, index - 1) + value.slice(index));
        refs.current[index - 1]?.focus();
      }
    } else if (event.key === "ArrowLeft" && index > 0) {
      event.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < length - 1) {
      event.preventDefault();
      refs.current[index + 1]?.focus();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    event.preventDefault();
    const clean = commit(text);
    refs.current[Math.min(clean.length, length - 1)]?.focus();
  };

  return (
    <div className={cx("o-code", invalid && "is-invalid")} role="group" aria-label={label}>
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(node) => {
            refs.current[index] = node;
          }}
          className={cx("o-code__box", Boolean(digit) && "is-filled")}
          inputMode="numeric"
          autoComplete={index === 0 ? "one-time-code" : "off"}
          pattern="[0-9]*"
          maxLength={length}
          aria-label={digitLabel(index + 1)}
          aria-invalid={invalid || undefined}
          value={digit}
          disabled={disabled}
          onChange={(event) => setDigit(index, event.target.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
          onPaste={onPaste}
          onFocus={(event) => event.currentTarget.select()}
        />
      ))}
    </div>
  );
}
