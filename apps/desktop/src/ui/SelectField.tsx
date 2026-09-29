import { ChevronDown } from "lucide-react";
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "./cx";
import "./fields.css";

export type SelectOption<T extends string = string> = { value: T; label: string; disabled?: boolean };

export type SelectFieldProps<T extends string = string> = Omit<ComponentPropsWithRef<"select">, "children"> & {
  label: string;
  options: ReadonlyArray<SelectOption<T>>;
  hint?: ReactNode;
  hideLabel?: boolean;
  fieldClassName?: string;
};

export function SelectField<T extends string = string>({
  label,
  options,
  hint,
  hideLabel = false,
  id,
  className,
  fieldClassName,
  ...rest
}: SelectFieldProps<T>) {
  const autoId = useId();
  const selectId = id ?? autoId;
  const hintId = hint ? `${selectId}-hint` : undefined;

  return (
    <div className={cx("o-field", fieldClassName)}>
      <label className={cx("o-field__label", hideLabel && "sr-only")} htmlFor={selectId}>{label}</label>
      <div className="o-field__control">
        <select {...rest} id={selectId} className={cx("o-field__select", className)} aria-describedby={hintId}>
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
          ))}
        </select>
        <ChevronDown className="o-field__chevron" aria-hidden="true" />
      </div>
      {hint ? <span className="o-field__hint" id={hintId}>{hint}</span> : null}
    </div>
  );
}
