import { translationEngineOptions } from "../../constants/ui";
import type { AppConfig } from "../../core/types";
import { translationStrings as t } from "../../strings/translation";
import { SegmentedControl, SelectField, Section, Switch, TextField } from "../../ui";
import { EstimateSummary } from "./EstimateSummary";
import { AUTOMATIC_MODEL, MAX_WORKERS, qualityOptions, type TranslationQuality, type TranslationScope } from "./translationModel";
import type { TranslationController } from "./useTranslationController";
import type { TranslationMemory } from "./useTranslationMemory";
import type { TranslationPlan } from "./useTranslationPlanner";

export function ConfigTab({ controller, plan, memory }: {
  controller: TranslationController;
  plan: TranslationPlan;
  memory: TranslationMemory;
}) {
  const { settings, patchSettings, setModel, config, onConfigChange } = controller;
  const languageOptions = t.languages.some((option) => option.value === config.targetLanguage)
    ? t.languages
    : [...t.languages, { value: config.targetLanguage, label: config.targetLanguage }];

  return (
    <div className="translation-config">
      <div className="translation-config__form">
        <Section className="translation-form-section" title={t.scopeHeading} description={t.scopeDescription}>
          <SegmentedControl<TranslationScope>
            aria-label={t.scopeLabel}
            value={settings.scope}
            onChange={(scope) => patchSettings({ scope })}
            options={[
              { value: "pilot", label: t.scopePilot },
              { value: "range", label: t.scopeRange },
              { value: "all", label: t.scopeAll }
            ]}
          />
          {settings.scope === "range" ? (
            <div className="translation-form-grid">
              <TextField
                label={t.rangeStart}
                type="number"
                min={1}
                max={plan.rangeEnd}
                value={settings.rangeStart}
                onChange={(event) => patchSettings({ rangeStart: Number(event.target.value) })}
                onBlur={() => patchSettings({ rangeStart: plan.rangeStart })}
              />
              <TextField
                label={t.rangeEnd}
                type="number"
                min={plan.rangeStart}
                max={plan.chapterCount}
                value={settings.rangeEnd}
                onChange={(event) => patchSettings({ rangeEnd: Number(event.target.value) })}
                onBlur={() => patchSettings({ rangeEnd: plan.rangeEnd })}
                hint={t.chapters(plan.chapterCount)}
              />
            </div>
          ) : (
            <p className="translation-form-note">{plan.scopeLabel}</p>
          )}
        </Section>

        <Section className="translation-form-section" title={t.qualityHeading} description={t.qualityDescription}>
          <SegmentedControl<TranslationQuality>
            aria-label={t.qualityLabel}
            value={settings.quality}
            onChange={(quality) => patchSettings({ quality })}
            options={qualityOptions.map((option) => ({ value: option.value, label: option.label }))}
          />
          <p className="translation-form-note">{plan.qualityProfile.detail}</p>
        </Section>

        <Section className="translation-form-section" title={t.modelHeading} description={t.modelDescription}>
          <div className="translation-form-grid">
            <SelectField<AppConfig["translationEngine"]>
              label={t.engine}
              value={config.translationEngine}
              options={translationEngineOptions}
              onChange={(event) => onConfigChange({ translationEngine: event.target.value as AppConfig["translationEngine"] })}
            />
            <SelectField
              label={t.model}
              value={settings.model}
              options={plan.selectableModels.map((model) => ({ value: model, label: model === AUTOMATIC_MODEL ? t.automaticModel : model }))}
              onChange={(event) => setModel(event.target.value)}
            />
            <SelectField
              label={t.targetLanguage}
              value={config.targetLanguage}
              options={languageOptions}
              onChange={(event) => onConfigChange({ targetLanguage: event.target.value })}
            />
          </div>
        </Section>

        <Section className="translation-form-section" title={t.costHeading} description={t.costDescription}>
          <div className="translation-form-grid">
            <TextField
              label={t.usdBrl}
              inputMode="decimal"
              value={settings.usdBrl}
              onChange={(event) => patchSettings({ usdBrl: event.target.value })}
            />
            <TextField
              label={t.budget}
              inputMode="decimal"
              placeholder={t.budgetPlaceholder}
              hint={t.budgetHint}
              value={settings.maxBudgetBrl}
              onChange={(event) => patchSettings({ maxBudgetBrl: event.target.value })}
            />
            <TextField
              label={t.workerCount}
              type="number"
              min={1}
              max={MAX_WORKERS}
              hint={t.workerHint}
              value={settings.workerCount}
              onChange={(event) => patchSettings({ workerCount: Number(event.target.value) })}
            />
            <TextField
              label={t.inputPrice}
              inputMode="decimal"
              hint={t.manualPriceHint}
              value={settings.inputUsdPerMillion}
              onChange={(event) => patchSettings({ inputUsdPerMillion: event.target.value })}
            />
            <TextField
              label={t.outputPrice}
              inputMode="decimal"
              hint={t.manualPriceHint}
              value={settings.outputUsdPerMillion}
              onChange={(event) => patchSettings({ outputUsdPerMillion: event.target.value })}
            />
          </div>
        </Section>

        <Section className="translation-form-section" title={t.executionHeading} description={t.executionDescription}>
          <div className="translation-switches">
            <Switch
              label={t.allowPaid}
              description={t.allowPaidDescription}
              checked={settings.allowPaidProviders}
              onChange={(allowPaidProviders) => patchSettings({ allowPaidProviders })}
            />
            <Switch
              label={t.allowGrader}
              description={t.allowGraderDescription}
              checked={settings.allowEditorialGrader}
              disabled={!settings.allowPaidProviders}
              onChange={(allowEditorialGrader) => patchSettings({ allowEditorialGrader })}
            />
          </div>
        </Section>
      </div>

      <EstimateSummary controller={controller} plan={plan} memory={memory} />
    </div>
  );
}
