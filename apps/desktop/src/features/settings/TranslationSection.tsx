import { ArrowRight, Languages, LogOut } from "lucide-react";
import { useId, type ReactNode } from "react";
import { settingsStrings } from "../../strings/settings";
import { modelLabel, translationSettingsStrings, translationStrings } from "../../strings/translation";
import type { TranslationEffort, TranslationModelId } from "../../services/translationClient";
import type { TranslationAccountState } from "../translation/useTranslationController";
import { Badge, Button, SegmentedControl, SelectField, Spinner } from "../../ui";
import { TRANSLATION_WORKERS_MAX, translationModels, useTranslationPreferences } from "./preferences";
import { SettingsGroup, SettingsRow, type Navigate } from "./settingsLayout";

/** "Tradução" category. Its id is still "audio" (the audiobook settings it used to hold are gone). */
export function TranslationSection({
  saved,
  onNavigate,
  translation
}: {
  saved: () => void;
  onNavigate: Navigate;
  translation: TranslationSettingsProps;
}) {
  return <TranslationGroup {...translation} onNavigate={onNavigate} saved={saved} />;
}

export type TranslationSettingsProps = {
  account: TranslationAccountState;
  connecting: boolean;
  loggingOut: boolean;
  onConnect: () => void;
  onCancelConnect: () => void;
  onLogout: () => void;
};

function TranslationAccountRow({ account, connecting, loggingOut, onConnect, onCancelConnect, onLogout }: TranslationSettingsProps) {
  const ts = translationSettingsStrings;
  let badge: ReactNode;
  let action: ReactNode = null;
  if (account.status === "logged_in") {
    badge = <Badge tone="success">{account.email ?? translationStrings.accountConnected}</Badge>;
    action = <Button size="sm" variant="ghost" icon={<LogOut />} loading={loggingOut} onClick={onLogout}>{translationStrings.logout}</Button>;
  } else if (account.status === "logged_out") {
    badge = connecting
      ? <span className="settings-value settings-inline"><Spinner size="sm" />{translationStrings.connectWaiting}</span>
      : <Badge>{translationStrings.accountDisconnected}</Badge>;
    action = connecting
      ? <Button size="sm" variant="ghost" onClick={onCancelConnect}>{translationStrings.connectCancel}</Button>
      : <Button size="sm" variant="primary" onClick={onConnect}>{translationStrings.connectShort}</Button>;
  } else if (account.status === "unavailable") {
    badge = <Badge>{ts.accountUnavailable}</Badge>;
  } else if (account.status === "error") {
    badge = <Badge tone="danger">{ts.accountError}</Badge>;
  } else {
    badge = <span className="settings-value">{ts.accountLoading}</span>;
  }
  return (
    <SettingsRow label={ts.account} testId="translation-account-status">
      <div className="settings-inline settings-inline--end">
        {badge}
        {action}
      </div>
    </SettingsRow>
  );
}

function TranslationGroup({ onNavigate, saved, ...account }: TranslationSettingsProps & { onNavigate: Navigate; saved: () => void }) {
  const ts = translationSettingsStrings;
  const [prefs, updatePrefs] = useTranslationPreferences();
  const modelId = useId();
  const effortId = useId();
  const languageId = useId();
  const update = (patch: Parameters<typeof updatePrefs>[0]) => {
    updatePrefs(patch);
    saved();
  };

  return (
    <SettingsGroup title={settingsStrings.groups.translation.title} description={ts.groupDescription}>
      <TranslationAccountRow {...account} />
      <SettingsRow label={ts.defaultModel} labelId={`${modelId}-label`} htmlFor={modelId} description={ts.defaultModelHint}>
        <SelectField<TranslationModelId>
          id={modelId}
          label={ts.defaultModel}
          hideLabel
          aria-labelledby={`${modelId}-label`}
          options={translationModels.map((model) => ({ value: model, label: `${modelLabel(model)} (${model})` }))}
          value={prefs.model}
          onChange={(event) => update({ model: event.target.value as TranslationModelId })}
        />
      </SettingsRow>
      <SettingsRow label={ts.effort} labelId={`${effortId}-label`} htmlFor={effortId} description={ts.effortHint}>
        <SelectField<TranslationEffort>
          id={effortId}
          label={ts.effort}
          hideLabel
          aria-labelledby={`${effortId}-label`}
          options={[
            { value: "none", label: translationStrings.effortLabels.none },
            { value: "low", label: translationStrings.effortLabels.low }
          ]}
          value={prefs.effort}
          onChange={(event) => update({ effort: event.target.value as TranslationEffort })}
        />
      </SettingsRow>
      <SettingsRow label={ts.workers} description={ts.workersHint}>
        <SegmentedControl<"1" | "2" | "3">
          aria-label={ts.workers}
          value={String(prefs.workers) as "1" | "2" | "3"}
          onChange={(value) => update({ workers: Number(value) })}
          options={Array.from({ length: TRANSLATION_WORKERS_MAX }, (_, index) => {
            const value = String(index + 1) as "1" | "2" | "3";
            return { value, label: value };
          })}
        />
      </SettingsRow>
      <SettingsRow label={ts.targetLanguage} labelId={`${languageId}-label`} htmlFor={languageId} description={ts.targetLanguageHint}>
        <SelectField
          id={languageId}
          label={ts.targetLanguage}
          hideLabel
          aria-labelledby={`${languageId}-label`}
          options={[{ value: "pt-BR", label: translationStrings.targetLanguage }]}
          value="pt-BR"
          disabled
          onChange={() => undefined}
        />
      </SettingsRow>
      <div className="settings-row settings-row--link">
        <Button variant="ghost" size="sm" icon={<Languages />} iconRight={<ArrowRight />} onClick={() => onNavigate("translation")}>
          {settingsStrings.openTranslation}
        </Button>
      </div>
    </SettingsGroup>
  );
}
