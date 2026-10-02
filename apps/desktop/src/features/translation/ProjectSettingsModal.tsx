import { useEffect, useState } from "react";
import type { ProjectDetail, TranslationEffort } from "../../services/translationClient";
import { modelLabel, translationStrings as t } from "../../strings/translation";
import { Button, Modal, SegmentedControl, SelectField } from "../../ui";
import { TRANSLATION_WORKERS_MAX, translationModels } from "../settings/preferences";

export const modelOptions = translationModels.map((model) => ({ value: model as string, label: `${modelLabel(model)} (${model})` }));
export const effortOptions: { value: TranslationEffort; label: string }[] = [
  { value: "none", label: t.effortLabels.none },
  { value: "low", label: t.effortLabels.low }
];
export const workerOptions = Array.from({ length: TRANSLATION_WORKERS_MAX }, (_, index) => {
  const value = String(index + 1) as "1" | "2" | "3";
  return { value, label: value };
});

type ProjectSettingsModalProps = {
  open: boolean;
  project: ProjectDetail;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: { model: string; effort: TranslationEffort; workers: number }) => Promise<boolean>;
};

/** Model, effort, simultaneous translations and auto-pause of one project. */
export function ProjectSettingsModal({ open, project, saving, onClose, onSave }: ProjectSettingsModalProps) {
  const [model, setModel] = useState(project.model);
  const [effort, setEffort] = useState<TranslationEffort>(project.effort);
  const [workers, setWorkers] = useState(project.workers);

  useEffect(() => {
    if (!open) return;
    setModel(project.model);
    setEffort(project.effort);
    setWorkers(project.workers);
  }, [open, project.effort, project.model, project.workers]);

  const models = modelOptions.some((option) => option.value === model) ? modelOptions : [...modelOptions, { value: model, label: model }];

  const save = async () => {
    if (await onSave({ model, effort, workers })) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t.settingsTitle}
      description={t.settingsDescription}
      dismissible={!saving}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>{t.cancel}</Button>
          <Button variant="primary" onClick={() => void save()} loading={saving}>{t.save}</Button>
        </>
      )}
    >
      <div className="translation-form">
        <SelectField label={t.model} hint={t.modelHint} options={models} value={model} onChange={(event) => setModel(event.target.value)} />
        <SelectField<TranslationEffort>
          label={t.effort}
          hint={t.effortHint}
          options={effortOptions}
          value={effort}
          onChange={(event) => setEffort(event.target.value as TranslationEffort)}
        />
        <div className="translation-form__row">
          <span className="translation-form__label">{t.workers}</span>
          <SegmentedControl
            aria-label={t.workers}
            size="sm"
            value={String(workers) as "1" | "2" | "3"}
            onChange={(value) => setWorkers(Number(value))}
            options={workerOptions}
          />
          <span className="translation-form__hint">{t.workersHint}</span>
        </div>
      </div>
    </Modal>
  );
}
