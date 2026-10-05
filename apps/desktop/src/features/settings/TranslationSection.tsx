import { ArrowRight, Languages } from "lucide-react";
import { useId } from "react";
import { settingsStrings } from "../../strings/settings";
import { modelLabel, translationSettingsStrings, translationStrings } from "../../strings/translation";
import type { TranslationEffort, TranslationModelId } from "../../services/translationClient";
import { Button, SegmentedControl, SelectField } from "../../ui";
import { TRANSLATION_WORKERS_MAX, translationModels, useTranslationPreferences, type WorkerCount } from "./preferences";
import { SettingsGroup, SettingsRow, type Navigate } from "./settingsLayout";

/** "Tradução" category. Its id is still "audio" (the audiobook settings it used to hold are gone). */
export function TranslationSection({ saved, onNavigate }: { saved: () => void; onNavigate: Navigate }) {
  return <TranslationGroup onNavigate={onNavigate} saved={saved} />;
}

function TranslationGroup({ onNavigate, saved }: { onNavigate: Navigate; saved: () => void }) {
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
        <SegmentedControl<WorkerCount>
          aria-label={ts.workers}
          value={String(prefs.workers) as WorkerCount}
          onChange={(value) => update({ workers: Number(value) })}
          options={Array.from({ length: TRANSLATION_WORKERS_MAX }, (_, index) => {
            const value = String(index + 1) as WorkerCount;
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
