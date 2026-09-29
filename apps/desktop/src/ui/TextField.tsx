import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "./cx";
import "./fields.css";

export type TextFieldProps = Omit<ComponentPropsWithRef<"input">, "size"> & {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Content before the input, e.g. a search icon. */
  leading?: ReactNode;
  /** Content after the input, e.g. a clear button (replaces the native search cancel button). */
  trailing?: ReactNode;
  /** Visually hides the label while keeping it accessible. */
  hideLabel?: boolean;
  fieldClassName?: string;
};

export function TextField({
  label,
  hint,
  error,
  leading,
  trailing,
  hideLabel = false,
  id,
  className,
  fieldClassName,
  type = "text",
  ...rest
}: TextFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;
  const describedBy = [hintId, errorId, rest["aria-describedby"]].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("o-field", Boolean(error) && "o-field--invalid", fieldClassName)}>
      <label className={cx("o-field__label", hideLabel && "sr-only")} htmlFor={inputId}>{label}</label>
      <div className={cx("o-field__control", Boolean(trailing) && "o-field__control--trailing")}>
        {leading ? <span className="o-field__adornment">{leading}</span> : null}
        <input
          {...rest}
          id={inputId}
          type={type}
          className={cx("o-field__input", className)}
          aria-invalid={error ? true : rest["aria-invalid"]}
          aria-describedby={describedBy}
        />
        {trailing ? <span className="o-field__adornment">{trailing}</span> : null}
      </div>
      {hint ? <span className="o-field__hint" id={hintId}>{hint}</span> : null}
      {error ? <span className="o-field__error" id={errorId}>{error}</span> : null}
    </div>
  );
}
