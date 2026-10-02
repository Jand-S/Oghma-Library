import { AlertTriangle, CheckCircle2, FlaskConical, Play, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { PilotSample, ProjectDetail } from "../../services/translationClient";
import { modelLabel, translationStrings as t } from "../../strings/translation";
import { Badge, Button, EmptyState, SegmentedControl, Spinner } from "../../ui";
import { Reader } from "./Reader";
import { formatCredits, formatDateTime, formatDecimal, formatTokens } from "./translationFormat";
import type { TranslationController } from "./useTranslationController";

const ORIGINAL = "original";

const sampleLabel = (sample: PilotSample) => modelLabel(sample.model) !== sample.model ? modelLabel(sample.model) : sample.label || sample.model;

/** Piloto: run both models on a ~1,500-word sample, compare, read side by side and pick one. */
export function PilotTab({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const pilot = controller.pilot;
  const running = pilot?.status === "running" || controller.isBusy(`${project.id}:pilot`);
  const samples = useMemo(() => pilot?.samples ?? [], [pilot]);
  const [view, setView] = useState<string>(ORIGINAL);

  // Default to the model in use once the samples arrive.
  useEffect(() => {
    if (samples.length === 0) {
      setView(ORIGINAL);
      return;
    }
    setView((current) => (current === ORIGINAL || samples.some((sample) => sample.model === current) ? current : ORIGINAL));
  }, [samples]);

  const current = samples.find((sample) => sample.model === view) ?? null;
  const choosing = controller.isBusy(`${project.id}:model`);
  const rows: { label: string; strong?: boolean; value: (sample: PilotSample) => ReactNode }[] = [
    { label: t.colModel, value: (sample) => <code className="translation-table__id">{sample.model}</code> },
    { label: t.colTime, value: (sample) => `${formatDecimal(sample.seconds)} s` },
    { label: t.colTokens, value: (sample) => t.tokensValue(formatTokens(sample.inputTokens), formatTokens(sample.outputTokens)) },
    { label: t.colCredits, strong: true, value: (sample) => (sample.projectedBookCredits != null ? t.creditsValue(formatCredits(sample.projectedBookCredits)) : "—") },
    {
      label: t.colValid,
      value: (sample) => (sample.valid ? (
        <span className="translation-valid is-ok"><CheckCircle2 aria-hidden="true" />{t.validOk}</span>
      ) : (
        <span className="translation-valid is-bad"><AlertTriangle aria-hidden="true" />{t.validBad}</span>
      ))
    }
  ];
  const hasRun = Boolean(pilot && (samples.length > 0 || pilot.status !== "running"));

  return (
    <div className="translation-pilot" data-testid="translation-pilot">
      <section className="translation-block" aria-labelledby="translation-pilot-title">
        <header className="translation-block__header">
          <div className="translation-block__heading">
            <h3 className="translation-block__title" id="translation-pilot-title">{t.pilotHeading}</h3>
            <p className="translation-block__description">{t.pilotDescription}</p>
          </div>
          <Button
            variant={samples.length ? "outline" : "primary"}
            icon={samples.length ? <RotateCcw /> : <Play />}
            loading={running}
            disabled={!controller.loggedIn || project.status === "preparing"}
            title={controller.loggedIn ? undefined : t.needsLogin}
            onClick={() => void controller.runPilot(project.id)}
          >
            {samples.length ? t.runPilotAgain : t.runPilot}
          </Button>
        </header>

        {running ? (
          <p className="translation-inline-status" role="status">
            <Spinner size="sm" />
            {t.pilotRunning}
          </p>
        ) : null}
        {pilot?.status === "error" ? (
          <p className="translation-inline-status translation-inline-status--danger" role="alert">
            <AlertTriangle aria-hidden="true" />
            {pilot.error || t.pilotFailed}
          </p>
        ) : null}

        {!hasRun && !running ? (
          <EmptyState
            className="translation-empty--compact"
            icon={<FlaskConical />}
            title={t.pilotEmptyTitle}
            description={`${t.pilotEmptyDescription} ${t.pilotSuggestion}`}
          />
        ) : null}

        {samples.length > 0 ? (
          <>
            <p className="translation-block__meta">{t.pilotSample(pilot?.words ?? 0, formatDateTime(pilot?.createdAt ?? 0))}</p>
            <div className="translation-table-wrap">
              <table className="translation-table translation-table--pilot" aria-label={t.pilotTable} data-testid="pilot-table">
                <thead>
                  <tr>
                    <th scope="col"><span className="sr-only">{t.colModel}</span></th>
                    {samples.map((sample) => (
                      <th scope="col" key={sample.model} className="is-num" data-testid="pilot-row">
                        <span className="translation-table__model">
                          {project.model === sample.model ? <Badge tone="accent">{t.inUse}</Badge> : null}
                          <span className="translation-table__model-name">{sampleLabel(sample)}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label} className={row.strong ? "is-strong" : undefined}>
                      <th scope="row">{row.label}</th>
                      {samples.map((sample) => <td key={sample.model} className="is-num">{row.value(sample)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="translation-block__meta">{t.creditsNote}</p>
          </>
        ) : null}
      </section>

      {samples.length > 0 ? (
        <section className="translation-block translation-block--reader" aria-label={t.readerTabs}>
          <header className="translation-block__header">
            <SegmentedControl<string>
              aria-label={t.readerTabs}
              size="sm"
              value={view}
              onChange={setView}
              options={[{ value: ORIGINAL, label: t.readerOriginal }, ...samples.map((sample) => ({ value: sample.model, label: sampleLabel(sample) }))]}
            />
            {current ? (
              project.model === current.model ? (
                <Badge tone="accent" data-testid="pilot-in-use">{t.inUse}</Badge>
              ) : (
                <Button variant="primary" size="sm" loading={choosing} onClick={() => void controller.chooseModel(project.id, current.model)}>
                  {t.useModel(sampleLabel(current))}
                </Button>
              )
            ) : null}
          </header>
          <Reader
            key={view}
            html={current ? current.html : pilot?.sourceHtml}
            label={current ? sampleLabel(current) : t.readerOriginal}
            lang={current ? "pt-BR" : "en"}
            testId="pilot-reader"
            className="translation-reader--pilot"
          />
        </section>
      ) : null}
    </div>
  );
}
