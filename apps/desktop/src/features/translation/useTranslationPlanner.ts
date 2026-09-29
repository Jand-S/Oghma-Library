import { useEffect, useMemo, useState } from "react";
import type { TranslationAutomaticPlan, TranslationCoverage, TranslationEstimate } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { translationStrings } from "../../strings/translation";
import {
  AUTOMATIC_MODEL,
  clampChapter,
  modelOptionsByEngine,
  parseDecimal,
  PILOT_CHAPTERS,
  plannerMode,
  providerForModel,
  qualityOptions,
  type TranslationBatchDraft
} from "./translationModel";
import type { TranslationController } from "./useTranslationController";

const ESTIMATE_DEBOUNCE_MS = 250;
/** Chars per chapter the manual fallback assumes when the book has no char count. */
const FALLBACK_TOKENS_PER_CHAPTER = 2600;

/**
 * Page-scoped planning for the next batch: resolves the chapter range, asks the
 * backend for an estimate, coverage and (for the automatic model) a sampling
 * plan, and falls back to the manual per-token prices while none is available.
 */
export function useTranslationPlanner(controller: TranslationController) {
  const { backend, config, selectedItem, settings, setModel } = controller;
  const [estimate, setEstimate] = useState<TranslationEstimate | null>(null);
  const [automaticPlan, setAutomaticPlan] = useState<TranslationAutomaticPlan | null>(null);
  const [coverage, setCoverage] = useState<TranslationCoverage | null>(null);
  const [estimateError, setEstimateError] = useState("");
  const [estimating, setEstimating] = useState(false);

  const { scope, quality, model } = settings;
  const usdBrl = parseDecimal(settings.usdBrl);
  const chapterCount = Math.max(1, selectedItem?.chapters || 1);
  const rangeStart = clampChapter(settings.rangeStart, chapterCount);
  const rangeEnd = Math.max(rangeStart, clampChapter(settings.rangeEnd, chapterCount));
  const pilotEnd = Math.min(PILOT_CHAPTERS, chapterCount);
  const chapterFrom = scope === "range" ? rangeStart : 1;
  const chapterTo = scope === "all" ? chapterCount : scope === "pilot" ? pilotEnd : rangeEnd;
  const scopeChapters = chapterTo - chapterFrom + 1;
  const scopeLabel = scope === "all"
    ? translationStrings.scopeAllLabel(chapterCount)
    : scope === "pilot"
    ? translationStrings.scopePilotLabel(pilotEnd)
    : translationStrings.scopeRangeLabel(rangeStart, rangeEnd);
  const scopedSourceChars = selectedItem?.sourceChars
    ? Math.max(1, Math.round(selectedItem.sourceChars * (scopeChapters / chapterCount)))
    : undefined;
  const novelId = selectedItem ? selectedItem.novelId ?? selectedItem.id : "";
  const mode = plannerMode(quality);

  // Backend estimate + coverage for the current range (debounced while typing).
  useEffect(() => {
    if (!novelId) {
      setEstimate(null);
      setCoverage(null);
      setEstimateError("");
      setEstimating(false);
      return;
    }
    let cancelled = false;
    setEstimating(true);
    setEstimateError("");
    const handle = window.setTimeout(() => {
      const request = { novelId, chapterFrom, chapterTo, mode, usdBrlRate: usdBrl, sourceChars: scopedSourceChars };
      void Promise.all([backend.estimateTranslation(request), backend.getTranslationCoverage(request)])
        .then(([estimatePayload, coveragePayload]) => {
          if (cancelled) return;
          setEstimate(estimatePayload);
          setCoverage(coveragePayload);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setEstimate(null);
          setCoverage(null);
          setEstimateError(getErrorMessage(error, translationStrings.estimateError));
        })
        .finally(() => {
          if (!cancelled) setEstimating(false);
        });
    }, ESTIMATE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [backend, chapterFrom, chapterTo, mode, novelId, scopedSourceChars, usdBrl]);

  // Sampling plan, only when the automatic model is chosen.
  useEffect(() => {
    if (!novelId || model !== AUTOMATIC_MODEL) {
      setAutomaticPlan(null);
      return;
    }
    let cancelled = false;
    void backend.getTranslationAutomaticPlan({
      novelId,
      chapterFrom,
      chapterTo,
      mode,
      maxSamples: 4,
      maxModels: 4,
      usdBrlRate: usdBrl,
      sourceChars: scopedSourceChars
    })
      .then((payload) => {
        if (!cancelled) setAutomaticPlan(payload);
      })
      .catch(() => {
        if (!cancelled) setAutomaticPlan(null);
      });
    return () => {
      cancelled = true;
    };
  }, [backend, chapterFrom, chapterTo, mode, model, novelId, scopedSourceChars, usdBrl]);

  const recommendedModels = useMemo(() => estimate?.recommendations.map((item) => item.model) ?? [], [estimate]);
  const engineModels = modelOptionsByEngine[config.translationEngine];
  const selectableModels = useMemo(
    () => [AUTOMATIC_MODEL, ...(recommendedModels.length ? recommendedModels : engineModels)],
    [engineModels, recommendedModels]
  );

  // Keep the chosen model among the ones currently offered.
  useEffect(() => {
    if (!selectableModels.includes(model)) setModel(recommendedModels[0] ?? selectableModels[0]);
  }, [model, recommendedModels, selectableModels, setModel]);

  const qualityProfile = qualityOptions.find((item) => item.value === quality) ?? qualityOptions[0];
  const recommendation = estimate?.recommendations.find((item) => item.model === model) ?? estimate?.recommendations[0] ?? null;

  // Manual fallback, used until the backend answers.
  const sourceTokens = scopedSourceChars ? Math.max(1, Math.ceil(scopedSourceChars / 4)) : scopeChapters * FALLBACK_TOKENS_PER_CHAPTER;
  const fallbackInputTokens = sourceTokens + scopeChapters * Math.max(0, qualityProfile.inputTokensPerChapter - FALLBACK_TOKENS_PER_CHAPTER);
  const fallbackOutputTokens = Math.round(sourceTokens * (qualityProfile.outputTokensPerChapter / FALLBACK_TOKENS_PER_CHAPTER));
  const fallbackUsd = (fallbackInputTokens / 1_000_000) * parseDecimal(settings.inputUsdPerMillion)
    + (fallbackOutputTokens / 1_000_000) * parseDecimal(settings.outputUsdPerMillion);

  const translationUsd = recommendation?.estimatedUsd ?? fallbackUsd;
  const translationBrl = recommendation?.estimatedBrl ?? fallbackUsd * usdBrl;
  const automatic = model === AUTOMATIC_MODEL && automaticPlan !== null;
  const estimatedUsd = automatic ? translationUsd + automaticPlan.estimatedSampleUsd : translationUsd;
  const estimatedBrl = automatic
    ? translationBrl + (automaticPlan.estimatedSampleBrl ?? automaticPlan.estimatedSampleUsd * usdBrl)
    : translationBrl;
  const graderUsd = model === AUTOMATIC_MODEL ? automaticPlan?.estimatedEditorialGraderUsd ?? 0 : 0;
  const graderBrl = automaticPlan?.estimatedEditorialGraderBrl ?? graderUsd * usdBrl;
  const estimatedTokens = estimate
    ? estimate.estimatedInputTokens + estimate.estimatedOutputTokens
    : fallbackInputTokens + fallbackOutputTokens;

  const buildDraft = (): TranslationBatchDraft | null => {
    if (!selectedItem) return null;
    return {
      projectId: selectedItem.id,
      novelId,
      title: selectedItem.title,
      chapters: scopeChapters,
      chapterFrom,
      chapterTo,
      scopeLabel,
      qualityLabel: qualityProfile.label,
      mode,
      model,
      provider: model === AUTOMATIC_MODEL ? "auto" : providerForModel(model, config.translationEngine),
      workerCount: settings.workerCount,
      estimatedBRL: estimatedBrl,
      estimatedTokens,
      sourceChars: scopedSourceChars
    };
  };

  return {
    chapterCount,
    rangeStart,
    rangeEnd,
    scopeLabel,
    qualityProfile,
    selectableModels,
    estimate,
    estimating,
    estimateError,
    coverage,
    recommendation,
    usingFallback: !estimate,
    estimatedUsd,
    estimatedBrl,
    estimatedTokens,
    graderUsd,
    graderBrl,
    buildDraft
  };
}

export type TranslationPlan = ReturnType<typeof useTranslationPlanner>;
