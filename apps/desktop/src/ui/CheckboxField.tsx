import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "./cx";
import "./fields.css";

export type CheckboxFieldProps = Omit<ComponentPropsWithRef<"input">, "type"> & {
  label: ReactNode;
  description?: ReactNode;
};

export function CheckboxField({ label, description, id, className, ...rest }: CheckboxFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const descriptionId = description ? `${inputId}-description` : undefined;
  return (
    <label className={cx("o-check", className)} htmlFor={inputId}>
      <input {...rest} id={inputId} type="checkbox" className="o-check__input" aria-describedby={descriptionId} />
      <span className="o-check__text">
        <span className="o-check__label">{label}</span>
        {description ? <span className="o-check__description" id={descriptionId}>{description}</span> : null}
      </span>
    </label>
  );
}
