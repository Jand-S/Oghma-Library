import { useEffect, useId, useState, type ReactNode } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { AppConfig } from "../../core/types";
import { settingsStrings } from "../../strings/settings";
import { Switch, cx } from "../../ui";

/*
 * Building blocks shared by the settings sections: group, row, switch row and the
 * text-field draft that only saves valid values.
 */

export type Save = (patch: Partial<AppConfig>) => void;
export type Navigate = (view: AppView) => void;

export function SettingsGroup({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={id}>
      <header className="settings-group__header">
        <h3 className="settings-group__title" id={id}>{title}</h3>
        <p className="settings-group__description">{description}</p>
      </header>
      <div className="settings-group__rows">{children}</div>
    </section>
  );
}

/**
 * One setting: text on the left, control on the right (`stacked` puts the control below).
 * With `htmlFor` the title is a real `<label>`; the control should then point
 * `aria-labelledby` at `labelId` so its accessible name is not doubled.
 */
export function SettingsRow({
  label,
  labelId,
  htmlFor,
  description,
  children,
  stacked = false,
  testId
}: {
  label: ReactNode;
  labelId?: string;
  htmlFor?: string;
  description?: ReactNode;
  children: ReactNode;
  stacked?: boolean;
  testId?: string;
}) {
  return (
    <div className={cx("settings-row", stacked && "settings-row--stacked")} data-testid={testId}>
      <div className="settings-row__text">
        {htmlFor ? (
          <label className="settings-row__label" id={labelId} htmlFor={htmlFor}>{label}</label>
        ) : (
          <span className="settings-row__label" id={labelId}>{label}</span>
        )}
        {description ? <p className="settings-row__description">{description}</p> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

/** A switch row: the Switch primitive already lays out label, description and track. */
export function SwitchRow(props: { label: string; description?: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className="settings-row settings-row--switch">
      <Switch {...props} className="settings-switch" />
    </div>
  );
}

/**
 * Local draft for a text setting. The config only changes on commit (blur/Enter) and
 * only when the value is valid; otherwise the error is shown inline on the field.
 */
export function useDraft(value: string, validate: (value: string) => string | null, commit: (value: string) => void) {
  const [draft, setDraftState] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftState(value);
    setError(null);
  }, [value]);

  const setDraft = (next: string) => {
    setDraftState(next);
    if (error) setError(null);
  };

  /** Validates and saves the draft. Returns the saved value, or null when invalid. */
  const flush = (): string | null => {
    const next = draft.trim();
    const problem = validate(next);
    if (problem) {
      setError(problem);
      return null;
    }
    if (next !== value) commit(next);
    if (next !== draft) setDraftState(next);
    return next;
  };

  return { draft, setDraft, error, flush };
}

export function validateServerUrl(value: string) {
  if (!value) return settingsStrings.serverUrlRequired;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return settingsStrings.serverUrlInvalid;
  } catch {
    return settingsStrings.serverUrlInvalid;
  }
  return null;
}

export const validateFolder = (value: string) => (value ? null : settingsStrings.outputPathRequired);
