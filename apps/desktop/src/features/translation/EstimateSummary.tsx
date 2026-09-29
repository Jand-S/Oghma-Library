import { translationStrings as t } from "../../strings/translation";
import { Badge, cx, Panel, Skeleton } from "../../ui";
import { coverageRangeLabel, currencyBRL, currencyUSD, durationLabel, modelLabel } from "./translationModel";
import type { TranslationController } from "./useTranslationController";
import type { TranslationMemory } from "./useTranslationMemory";
import type { TranslationPlan } from "./useTranslationPlanner";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="translation-summary__row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Cost and model summary of the next batch, with the backend's model recommendations. */
export function EstimateSummary({ controller, plan, memory }: {
  controller: TranslationController;
  plan: TranslationPlan;
  memory: TranslationMemory;
}) {
  const { settings, setModel } = controller;
  const recommendations = plan.estimate?.recommendations.slice(0, 4) ?? [];
  const coverage = plan.coverage;

  return (
    <Panel className="translation-summary" title={t.summaryHeading} description={t.summaryDescription}>
      <div className="translation-summary__total" aria-busy={plan.estimating || undefined} data-testid="translation-estimate">
        {plan.estimating && !plan.estimate ? (
          <Skeleton width="60%" height="2em" />
        ) : (
          <>
            <strong className="translation-summary__brl">{currencyBRL.format(plan.estimatedBrl)}</strong>
            <span className="translation-summary__usd">{currencyUSD.format(plan.estimatedUsd)}</span>
          </>
        )}
      </div>

      <dl className="translation-summary__rows">
        <Row label={t.summaryScope} value={plan.scopeLabel} />
        <Row label={t.summaryQuality} value={plan.qualityProfile.label} />
        <Row label={t.summaryModel} value={modelLabel(settings.model)} />
        <Row label={t.summaryTokens} value={plan.estimatedTokens.toLocaleString("pt-BR")} />
        {plan.recommendation ? <Row label={t.summaryDuration} value={durationLabel(plan.recommendation.estimatedDurationSeconds)} /> : null}
        {plan.graderUsd > 0 ? (
          <Row label={t.summaryGrader} value={`${currencyUSD.format(plan.graderUsd)} · ${currencyBRL.format(plan.graderBrl)}`} />
        ) : null}
        <Row label={t.reuse} value={coverage ? `${coverage.translatedCount}/${coverage.selectedCount}` : t.calculating} />
        <Row label={t.savings} value={currencyBRL.format(coverage?.estimatedSavingsBrl ?? 0)} />
        <Row label={t.ranges} value={coverage ? coverageRangeLabel(coverage.ranges) : "–"} />
      </dl>

      {plan.estimateError ? (
        <p className="translation-summary__note translation-summary__note--error" role="alert">{plan.estimateError}</p>
      ) : plan.usingFallback && !plan.estimating ? (
        <p className="translation-summary__note">{t.summaryManualPrices}</p>
      ) : null}

      {recommendations.length ? (
        <div className="translation-summary__section">
          <h3 className="translation-summary__heading">{t.recommendations}</h3>
          <ul className="translation-models">
            {recommendations.map((item, index) => {
              const selected = settings.model === item.model;
              return (
                <li key={item.model}>
                  <button
                    type="button"
                    className={cx("translation-model", selected && "is-selected")}
                    aria-pressed={selected}
                    onClick={() => setModel(item.model)}
                  >
                    <span className="translation-model__head">
                      <span className="translation-model__name">{item.model}</span>
                      {index === 0 ? <Badge tone="accent">{t.recommended}</Badge> : null}
                      {item.experimental ? <Badge tone="warning">{t.experimental}</Badge> : null}
                    </span>
                    <span className="translation-model__meta">
                      {item.estimatedBrl != null ? currencyBRL.format(item.estimatedBrl) : t.brlUnavailable}
                      {" · "}{currencyUSD.format(item.estimatedUsd)}
                      {" · "}{durationLabel(item.estimatedDurationSeconds)}
                      {" · "}{item.qualityScore ? t.score(item.qualityScore) : t.noScore}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {memory.selectionHistory.length ? (
        <div className="translation-summary__section">
          <h3 className="translation-summary__heading">{t.selectionHistory}</h3>
          <ul className="translation-summary__history">
            {memory.selectionHistory.map((record) => (
              <li key={record.id}>{t.selectionRecord(record.winnerModel, record.sampleChapters.length, record.editorialGradeCount)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
