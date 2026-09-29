import { Layers, MoreVertical, Pause, Play, RotateCcw, SlidersHorizontal, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, ConfirmationModal, DropdownMenu, EmptyState, IconButton, ProgressBar, Section } from "../../ui";
import {
  batchStatusTone,
  coverageRangeLabel,
  currencyBRL,
  durationLabel,
  modelLabel,
  type TranslationSessionItem
} from "./translationModel";
import type { TranslationController } from "./useTranslationController";
import type { TranslationPlan } from "./useTranslationPlanner";

type PendingConfirm = { kind: "cancel" | "remove"; item: TranslationSessionItem } | null;

function isLive(item: TranslationSessionItem) {
  return Boolean(item.jobId) && item.status !== "done" && item.status !== "cancelled";
}

function BatchRow({ item, busy, controller, onConfirm }: {
  item: TranslationSessionItem;
  busy: boolean;
  controller: TranslationController;
  onConfirm: (next: PendingConfirm) => void;
}) {
  const hasJob = Boolean(item.jobId);
  const canRun = hasJob && (item.status === "waiting" || item.status === "ready");
  const canPause = hasJob && item.status === "translating";
  const canResume = hasJob && item.status === "paused";
  const canCancel = isLive(item);
  const cost = item.actualCostBRL && item.actualCostBRL > 0 ? item.actualCostBRL : item.estimatedBRL;
  const progress = item.progressPercent ?? 0;
  const meta = t.batchMeta([
    item.qualityLabel,
    modelLabel(item.model),
    t.workers(item.workerCount),
    item.jobId ? t.jobId(item.jobId) : ""
  ]);

  return (
    <li className="translation-batch" data-testid="translation-batch" data-status={item.status}>
      <div className="translation-batch__main">
        <div className="translation-batch__title-row">
          <span className="translation-batch__title">{item.scopeLabel}</span>
          <Badge tone={batchStatusTone[item.status]}>{t.batchStatus[item.status]}</Badge>
        </div>
        <span className="translation-batch__meta">{meta}</span>
        {hasJob ? (
          <ProgressBar
            size="sm"
            label={t.projectProgress(item.scopeLabel)}
            value={progress}
            valueText={`${Math.round(progress)}%`}
            tone={item.status === "failed" ? "danger" : item.status === "done" ? "success" : "accent"}
          />
        ) : null}
        {item.telemetryReason ? (
          <span className="translation-batch__detail" title={item.telemetryReason}>
            {t.etaLine(durationLabel(item.etaSeconds), currencyBRL.format(item.estimatedRemainingBRL ?? 0))}
          </span>
        ) : null}
        {item.retryCount || item.repairCount || item.failedCount ? (
          <span className="translation-batch__detail">
            {t.qualityLine(item.retryCount ?? 0, item.repairCount ?? 0, item.failedCount ?? 0)}
          </span>
        ) : null}
      </div>
      <div className="translation-batch__numbers">
        <strong>{currencyBRL.format(cost)}</strong>
        <span>{t.chapters(item.chapters)}{hasJob ? ` · ${Math.round(progress)}%` : ""}</span>
      </div>
      <div className="translation-batch__actions">
        {canRun ? (
          <IconButton size="sm" label={t.runBatch(item.scopeLabel)} icon={<Play />} disabled={busy} onClick={() => void controller.runJob(item)} />
        ) : null}
        {canPause ? (
          <IconButton size="sm" label={t.pauseBatch(item.scopeLabel)} icon={<Pause />} disabled={busy} onClick={() => void controller.pauseJob(item)} />
        ) : null}
        {canResume ? (
          <IconButton size="sm" label={t.resumeBatch(item.scopeLabel)} icon={<RotateCcw />} disabled={busy} onClick={() => void controller.resumeJob(item)} />
        ) : null}
        <DropdownMenu
          label={t.batchActions(item.scopeLabel)}
          align="end"
          trigger={<IconButton size="sm" label={t.batchActions(item.scopeLabel)} icon={<MoreVertical />} disabled={busy} />}
          items={[
            { label: t.cancelJob, icon: <XCircle />, disabled: !canCancel, onSelect: () => onConfirm({ kind: "cancel", item }) },
            {
              label: t.removeBatch,
              icon: <Trash2 />,
              danger: true,
              separatorBefore: true,
              onSelect: () => (isLive(item) ? onConfirm({ kind: "remove", item }) : controller.removeBatch(item.id))
            }
          ]}
        />
      </div>
    </li>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="translation-stat">
      <span className="translation-stat__label">{label}</span>
      <strong className="translation-stat__value">{value}</strong>
    </div>
  );
}

export function SessionTab({ controller, plan, onOpenConfig }: {
  controller: TranslationController;
  plan: TranslationPlan;
  onOpenConfig: () => void;
}) {
  const [confirm, setConfirm] = useState<PendingConfirm>(null);
  const items = controller.projectItems;
  const sum = (pick: (item: TranslationSessionItem) => number) => items.reduce((total, item) => total + pick(item), 0);
  const coverage = plan.coverage;

  const onConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === "cancel") void controller.cancelJob(confirm.item);
    else controller.removeBatch(confirm.item.id);
    setConfirm(null);
  };

  return (
    <Section className="translation-tab" title={t.sessionHeading} description={t.sessionDescription}>
      <div className="translation-stats">
        <Metric label={t.metricEstimate} value={currencyBRL.format(sum((item) => item.estimatedBRL))} />
        <Metric label={t.metricActual} value={currencyBRL.format(sum((item) => item.actualCostBRL ?? 0))} />
        <Metric
          label={t.metricRemaining}
          value={`${currencyBRL.format(sum((item) => item.estimatedRemainingBRL ?? 0))} · ${durationLabel(sum((item) => item.etaSeconds ?? 0), "–")}`}
        />
        <Metric
          label={t.metricVolume}
          value={`${sum((item) => item.chapters).toLocaleString("pt-BR")} · ${sum((item) => item.estimatedTokens).toLocaleString("pt-BR")}`}
        />
      </div>

      <div className="translation-next" data-testid="translation-next-batch">
        <div className="translation-next__main">
          <span className="translation-next__label">{t.nextBatch}</span>
          <span className="translation-next__value">
            {t.batchMeta([plan.scopeLabel, plan.qualityProfile.label, modelLabel(controller.settings.model)])}
          </span>
          <span className="translation-next__coverage">
            {t.reuse}: <strong>{coverage ? `${coverage.translatedCount}/${coverage.selectedCount}` : t.calculating}</strong>
            {" · "}{t.missing}: <strong>{coverage ? coverage.missingCount.toLocaleString("pt-BR") : "–"}</strong>
            {" · "}{t.savings}: <strong>{currencyBRL.format(coverage?.estimatedSavingsBrl ?? 0)}</strong>
            {" · "}{t.ranges}: <strong>{coverage ? coverageRangeLabel(coverage.ranges) : "–"}</strong>
          </span>
        </div>
        <strong className="translation-next__cost">{currencyBRL.format(plan.estimatedBrl)}</strong>
        <Button size="sm" variant="ghost" icon={<SlidersHorizontal />} onClick={onOpenConfig}>{t.adjustConfig}</Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="translation-empty--compact"
          icon={<Layers />}
          title={t.emptyBatchesTitle}
          description={t.emptyBatchesDescription}
          action={<Button size="sm" onClick={onOpenConfig}>{t.emptyBatchesAction}</Button>}
        />
      ) : (
        <ul className="translation-batches" aria-label={t.batchesLabel}>
          {items.map((item) => (
            <BatchRow key={item.id} item={item} busy={controller.busyIds.has(item.id)} controller={controller} onConfirm={setConfirm} />
          ))}
        </ul>
      )}

      <ConfirmationModal
        open={confirm !== null}
        tone="danger"
        title={confirm?.kind === "cancel" ? t.cancelConfirmTitle : t.removeConfirmTitle}
        description={confirm
          ? confirm.kind === "cancel" ? t.cancelConfirmDescription(confirm.item.scopeLabel) : t.removeConfirmDescription(confirm.item.scopeLabel)
          : undefined}
        confirmLabel={confirm?.kind === "cancel" ? t.cancelConfirmLabel : t.removeConfirmLabel}
        cancelLabel={t.keepLabel}
        onConfirm={onConfirm}
        onClose={() => setConfirm(null)}
      />
    </Section>
  );
}
