import { useId, type ReactNode } from "react";
import { cx } from "./cx";
import "./fields.css";

export type SwitchProps = {
  label: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
};

export function Switch({ label, description, checked, onChange, disabled, className }: SwitchProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-description` : undefined}
      disabled={disabled}
      className={cx("o-switch", className)}
      onClick={() => onChange(!checked)}
    >
      <span className="o-check__text">
        <span className="o-check__label" id={`${id}-label`}>{label}</span>
        {description ? <span className="o-check__description" id={`${id}-description`}>{description}</span> : null}
      </span>
      <span className="o-switch__track" aria-hidden="true">
        <span className="o-switch__thumb" />
      </span>
    </button>
  );
}
