import { BookPlus, Eye, ImageIcon, Library, Pause, Play, RotateCcw, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { LimitState, LogEvent, ProjectDetail, TranslationScope } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Button, ConfirmationModal, Cover, ProgressBar, SegmentedControl, Switch, TextField, cx } from "../../ui";
import { limitMessage } from "./AccountStrip";
import {
  formatClock,
  formatCredits,
  formatDateTime,
  formatDecimal,
  formatDuration,
  formatPercent,
  formatWords,
  isActive,
  useNow
} from "./translationFormat";
import type { TranslationController } from "./useTranslationController";

function StatCard({ label, value, note, testId }: { label: string; value: ReactNode; note?: ReactNode; testId: string }) {
  return (
    <div className="translation-card" data-testid={testId}>
      <span className="translation-card__label">{label}</span>
      <span className="translation-card__value">{value}</span>
      <span className="translation-card__note">{note || " "}</span>
    </div>
  );
}

type BannerKind = "paused" | "waiting" | "done" | "exported" | "error" | "preparing";

function Banner({ kind, title, tooltip, children }: { kind: BannerKind; title: string; tooltip?: string; children: ReactNode }) {
  return (
    <div className={cx("translation-banner", `translation-banner--${kind}`)} role="status" title={tooltip} data-testid="translation-banner" data-kind={kind}>
      <strong className="translation-banner__title">{title}</strong>
      <span className="translation-banner__detail">{children}</span>
    </div>
  );
}

function WaitingBanner({ resumeAt, limit }: { resumeAt: number | null; limit: LimitState | null }) {
  const now = useNow(1000);
  const detail = limitMessage(limit, resumeAt ?? limit?.nextRetryAt ?? null, now);
  return (
    <Banner kind="waiting" title={t.bannerWaiting} tooltip={t.limitTooltip}>
      <span data-testid="translation-waiting-detail">{detail}</span>
    </Banner>
  );
}

function StatusBanner({ project, limit }: { project: ProjectDetail; limit: LimitState | null }) {
  switch (project.status) {
    case "paused":
      return <Banner kind="paused" title={t.bannerPaused}>{t.bannerPausedDetail}</Banner>;
    case "waiting_limit":
      return <WaitingBanner resumeAt={project.resumeAt} limit={limit} />;
    case "done":
      return <Banner kind="done" title={t.bannerDone}>{t.bannerDoneDetail}</Banner>;
    case "exported":
      return <Banner kind="exported" title={t.bannerExported}>{t.bannerExportedDetail(`${project.title} (PT-BR)`)}</Banner>;
    case "error":
      return <Banner kind="error" title={t.bannerError}>{t.bannerErrorDetail}</Banner>;
    case "preparing":
      return <Banner kind="preparing" title={t.bannerPreparing}>{t.bannerPreparingDetail}</Banner>;
    default:
      return null;
  }
}

/** Colored log, newest at the bottom; sticks to the bottom unless the user scrolled up. */
function LogList({ events }: { events: LogEvent[] }) {
  const ref = useRef<HTMLOListElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && stick.current) element.scrollTop = element.scrollHeight;
  }, [events]);
  if (events.length === 0) return <p className="translation-log__empty">{t.logEmpty}</p>;
  return (
    <ol
      ref={ref}
      className="translation-log"
      role="log"
      aria-label={t.logHeading}
      tabIndex={0}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
    >
      {events.map((event, index) => (
        <li key={`${event.at}-${index}`} className="translation-log__item" data-level={event.level}>
          <time className="translation-log__time">{formatClock(event.at)}</time>
          {event.level !== "info" ? <span className="translation-log__level">{t.logLevel[event.level]}</span> : null}
          <span className="translation-log__message">{event.message}</span>
        </li>
      ))}
    </ol>
  );
}

function ScopeControl({ project, locked, onChange }: { project: ProjectDetail; locked: boolean; onChange: (scope: TranslationScope) => void }) {
  const total = Math.max(1, project.chaptersTotal);
  const [from, setFrom] = useState(project.scope.kind === "range" ? String(project.scope.from) : "1");
  const [to, setTo] = useState(project.scope.kind === "range" ? String(project.scope.to) : String(total));
  const rangeFrom = project.scope.kind === "range" ? project.scope.from : null;
  const rangeTo = project.scope.kind === "range" ? project.scope.to : null;
  useEffect(() => {
    if (rangeFrom != null) setFrom(String(rangeFrom));
    if (rangeTo != null) setTo(String(rangeTo));
  }, [rangeFrom, rangeTo]);

  const commit = () => {
    const a = Math.max(1, Math.min(total, Math.round(Number(from)) || 1));
    const b = Math.max(a, Math.min(total, Math.round(Number(to)) || total));
    setFrom(String(a));
    setTo(String(b));
    if (project.scope.kind === "range" && project.scope.from === a && project.scope.to === b) return;
    onChange({ kind: "range", from: a, to: b });
  };

  return (
    <div className="translation-scope" title={locked ? t.scopeLocked : undefined}>
      <span className="translation-scope__label">{t.scope}</span>
      <SegmentedControl<"all" | "range">
        aria-label={t.scope}
        size="sm"
        value={project.scope.kind}
        onChange={(kind) => {
          if (locked || kind === project.scope.kind) return;
          if (kind === "all") onChange({ kind: "all" });
          else onChange({ kind: "range", from: Number(from) || 1, to: Number(to) || total });
        }}
        options={[
          { value: "all", label: t.scopeAll, disabled: locked && project.scope.kind !== "all" },
          { value: "range", label: t.scopeRange, disabled: locked && project.scope.kind !== "range" }
        ]}
      />
      {project.scope.kind === "range" ? (
        <span className="translation-scope__range">
          <TextField
            label={t.scopeFrom}
            hideLabel
            type="number"
            min={1}
            max={total}
            inputMode="numeric"
            fieldClassName="o-field--sm translation-scope__field"
            value={from}
            disabled={locked}
            onChange={(event) => setFrom(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && commit()}
          />
          <span aria-hidden="true">–</span>
          <TextField
            label={t.scopeTo}
            hideLabel
            type="number"
            min={1}
            max={total}
            inputMode="numeric"
            fieldClassName="o-field--sm translation-scope__field"
            value={to}
            disabled={locked}
            onChange={(event) => setTo(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => event.key === "Enter" && commit()}
          />
        </span>
      ) : null}
    </div>
  );
}

/** "Livro PT-BR": preview before the end, translated cover (original × translated), cover switch. */
function BookBlock({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const id = project.id;
  const finished = project.status === "done" || project.status === "exported";
  const translatedId = project.sourceNovelId ? `${project.sourceNovelId}:pt-BR` : null;
  const original = controller.library.find((item) => project.sourceNovelId && item.novelId === project.sourceNovelId);
  const translated = controller.library.find((item) => translatedId && item.novelId === translatedId);
  const coverOn = project.translateCover !== false;
  return (
    <section className="translation-block" aria-labelledby="translation-book-title" data-testid="translation-book">
      <header className="translation-block__header">
        <h3 className="translation-block__title" id="translation-book-title">{t.bookHeading}</h3>
      </header>
      {!finished ? (
        <div className="translation-book__row">
          <Button
            icon={<Eye />}
            loading={controller.isBusy(`${id}:preview`)}
            disabled={project.chaptersDone === 0}
            onClick={() => void controller.exportPreview(id)}
            data-testid="translation-preview"
          >
            {t.previewNow}
          </Button>
          <p className="translation-book__hint">
            {t.previewHint(project.chaptersDone, project.chaptersTotal)}
            {project.lastPreviewAt ? <> {t.previewAgo(formatDateTime(project.lastPreviewAt))}</> : null}
          </p>
        </div>
      ) : null}
      <Switch
        label={t.translateCover}
        description={t.translateCoverHint}
        checked={coverOn}
        onChange={(checked) => void controller.updateSettings(id, { translateCover: checked })}
      />
      {translated?.coverUrl ? (
        <div className="translation-book__covers" data-testid="translation-covers">
          <figure className="translation-book__cover">
            <Cover src={original?.coverUrl} title={project.title} size="fill" />
            <figcaption>{t.coverOriginal}</figcaption>
          </figure>
          <figure className="translation-book__cover">
            <Cover src={translated.coverUrl} title={translated.title} size="fill" />
            <figcaption>{t.coverTranslated}</figcaption>
          </figure>
          <Button
            size="sm"
            variant="ghost"
            icon={<ImageIcon />}
            loading={controller.isBusy(`${id}:cover`)}
            disabled={!controller.loggedIn || !coverOn}
            onClick={() => void controller.regenerateCover(id)}
          >
            {t.regenerateCover}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Progresso: the mol dashboard (4 cards, bar, situation, controls, log). */
export function ProgressTab({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const { status } = project;
  const id = project.id;
  const running = controller.isBusy(`${id}:run`);
  const exporting = controller.isBusy(`${id}:export`);
  const active = isActive(status);
  const finished = status === "done" || status === "exported";
  const percent = project.chunksTotal > 0 ? (100 * project.chunksDone) / project.chunksTotal : project.percent;
  const canStart = controller.loggedIn && status !== "preparing";

  let primary: ReactNode = null;
  if (active) {
    primary = <Button icon={<Pause />} loading={running} onClick={() => void controller.pause(id)}>{t.pause}</Button>;
  } else if (status === "paused" || status === "error") {
    primary = <Button variant="primary" icon={<Play />} loading={running} disabled={!canStart} title={controller.loggedIn ? undefined : t.needsLogin} onClick={() => void controller.start(id)}>{t.resume}</Button>;
  } else if (status === "ready" || status === "preparing") {
    primary = <Button variant="primary" icon={<Play />} loading={running || status === "preparing"} disabled={!canStart} title={controller.loggedIn ? undefined : t.needsLogin} onClick={() => void controller.start(id)}>{t.start}</Button>;
  } else if (status === "done") {
    primary = <Button variant="primary" icon={<BookPlus />} loading={exporting} onClick={() => void controller.exportBook(id)}>{t.exportBook}</Button>;
  } else if (status === "exported") {
    primary = (
      <>
        {project.outputDir ? (
          <Button variant="primary" icon={<Library />} onClick={() => controller.openInLibrary(project.outputDir ?? "")}>{t.openInLibrary}</Button>
        ) : null}
        <Button icon={<RotateCcw />} loading={exporting} onClick={() => void controller.exportBook(id)}>{t.exportAgain}</Button>
      </>
    );
  }

  // The plan's usage % has no API: the 4th card shows the app's own 5h counter.
  const local = controller.usage?.local;

  return (
    <div className="translation-progress" data-testid="translation-progress" data-status={status}>
      <StatusBanner project={project} limit={controller.usage?.limitReached ?? null} />
      <div className="translation-cards">
        <StatCard testId="card-chapters" label={t.cardChapters} value={project.chaptersDone.toLocaleString("pt-BR")} note={t.of(project.chaptersTotal.toLocaleString("pt-BR"))} />
        <StatCard testId="card-words" label={t.cardWords} value={formatWords(project.wordsDone)} note={t.of(formatWords(project.wordsTotal))} />
        <StatCard
          testId="card-eta"
          label={t.cardEta}
          value={finished ? t.etaDone : formatDuration(project.etaSeconds)}
          note={!finished && project.chunksPerMinute ? t.chunksPerMinute(formatDecimal(project.chunksPerMinute)) : undefined}
        />
        <StatCard
          testId="card-credits"
          label={t.cardCredits}
          value={local ? t.creditsCardValue(formatCredits(local.credits5h)) : "—"}
          note={local ? t.creditsCardNote(formatWords(local.words5h)) : undefined}
        />
      </div>

      <section className="translation-block" aria-labelledby="translation-progress-title">
        <header className="translation-block__header">
          <h3 className="translation-block__title" id="translation-progress-title">{t.progressHeading}</h3>
          <ScopeControl
            project={project}
            locked={active}
            onChange={(scope) => void controller.updateSettings(id, { scope }, t.scopeFailed)}
          />
        </header>
        <ProgressBar
          label={t.progressBar}
          value={percent}
          valueText={`${formatPercent(percent)}%`}
          tone={finished ? "success" : status === "error" ? "danger" : "accent"}
          className={cx("translation-progress__bar", (status === "paused" || status === "waiting_limit") && "translation-bar--warn")}
        />
        <div className="translation-progress__row">
          <span>{t.chunksCount(project.chunksDone, project.chunksTotal)}</span>
          <span className="translation-progress__percent" data-testid="translation-percent">{formatDecimal(percent)}%</span>
        </div>
        <div className="translation-actions">
          {primary}
          {active || status === "paused" ? (
            <Button variant="ghost" icon={<X />} disabled={running} onClick={() => setConfirmCancel(true)}>{t.cancelRun}</Button>
          ) : null}
          {!controller.loggedIn && !finished ? <span className="translation-actions__hint">{t.needsLogin}</span> : null}
        </div>
      </section>

      <BookBlock controller={controller} project={project} />

      <section className="translation-block" aria-labelledby="translation-status-title">
        <header className="translation-block__header">
          <h3 className="translation-block__title" id="translation-status-title">{t.statusHeading}</h3>
        </header>
        <dl className="translation-status">
          <div className="translation-status__item">
            <dt>{t.statusPending}</dt>
            <dd>{project.pending.toLocaleString("pt-BR")}</dd>
          </div>
          <div className={cx("translation-status__item", project.needsReview > 0 && "is-warn")}>
            <dt>{t.statusReview}</dt>
            <dd>{project.needsReview.toLocaleString("pt-BR")}</dd>
          </div>
          <div className={cx("translation-status__item", project.errors > 0 && "is-danger")}>
            <dt>{t.statusErrors}</dt>
            <dd>{project.errors.toLocaleString("pt-BR")}</dd>
          </div>
          <div className="translation-status__item translation-status__item--wide">
            <dt>{t.statusInProgress}</dt>
            <dd className="truncate" title={project.chaptersInProgress.join(", ")}>
              {project.chaptersInProgress.length ? project.chaptersInProgress.join(", ") : t.statusNone}
            </dd>
          </div>
        </dl>
      </section>

      <section className="translation-block translation-block--log" aria-labelledby="translation-log-title">
        <header className="translation-block__header">
          <h3 className="translation-block__title" id="translation-log-title">{t.logHeading}</h3>
        </header>
        <LogList events={controller.logs} />
      </section>

      <ConfirmationModal
        open={confirmCancel}
        tone="danger"
        title={t.cancelConfirmTitle}
        description={t.cancelConfirmDescription}
        confirmLabel={t.cancelConfirm}
        cancelLabel={t.cancelKeep}
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void controller.cancel(id);
        }}
      />
    </div>
  );
}
