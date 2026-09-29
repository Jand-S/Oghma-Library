import { ArrowLeft, ArrowRight, BookOpenText, CheckCircle2, CircleAlert, Clock3, Download, Globe2, LoaderCircle, RefreshCcw, Search, Tablet, X } from "lucide-react";
import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import type { SetupSyncEntry } from "../../constants/ui";
import { defaultAppConfig } from "../../core/appConfig";
import type { AppConfig, ServerProbe, SourceSite } from "../../core/types";
import { onboardingStrings } from "../../strings/onboarding";
import { Badge, Button, cx, IconButton, ProgressBar, Switch, TextField } from "../../ui";
import { getFocusable } from "../../ui/focus";
import { FolderField } from "../settings/FolderField";
import { FormatPicker } from "../settings/FormatPicker";
import { sourceDomain } from "../sources/SourcesView";
import "./onboarding.css";

export type OnboardingWizardProps = {
  open: boolean;
  allowClose: boolean;
  step: number;
  config: AppConfig;
  sources: SourceSite[];
  serverProbe: ServerProbe | null;
  probingServer: boolean;
  /** Inline error of the last failed server check (for the current URL). */
  serverError?: string | null;
  setupSync: Record<string, SetupSyncEntry>;
  setupSyncRunning: boolean;
  setupSyncCompleted: boolean;
  onChange: (patch: Partial<AppConfig>) => void;
  onToggleSource: (sourceId: string) => void;
  onValidateServer: () => void;
  /** Runs the initial sync again after a failure. */
  onRetrySync?: () => void;
  onBack: () => void;
  onNext: () => void;
  onClose: () => void;
};

type StepContext = OnboardingWizardProps & {
  selectedSources: SourceSite[];
  serverVerified: boolean;
  syncFinished: boolean;
  syncFailed: boolean;
};

type StepDefinition = {
  id: "welcome" | "server" | "folder" | "preferences" | "sync";
  title: string;
  lead: string;
  canProceed: (ctx: StepContext) => boolean;
  nextLabel: (ctx: StepContext) => string;
  render: (ctx: StepContext) => ReactNode;
};

const nextLabel = () => onboardingStrings.next;

/** The wizard, as data. Step names in the indicator come from `onboardingStrings.steps`. */
export const steps: StepDefinition[] = [
  {
    id: "welcome",
    title: onboardingStrings.welcomeTitle,
    lead: onboardingStrings.welcomeLead,
    canProceed: () => true,
    nextLabel: () => onboardingStrings.start,
    render: () => <WelcomeStep />
  },
  {
    id: "server",
    title: onboardingStrings.serverTitle,
    lead: onboardingStrings.serverLead,
    canProceed: (ctx) => ctx.serverVerified,
    nextLabel,
    render: (ctx) => <ServerStep ctx={ctx} />
  },
  {
    id: "folder",
    title: onboardingStrings.folderTitle,
    lead: onboardingStrings.folderLead,
    canProceed: (ctx) => ctx.config.outputPath.trim().length > 0,
    nextLabel,
    render: (ctx) => <FolderStep ctx={ctx} />
  },
  {
    id: "preferences",
    title: onboardingStrings.preferencesHeading,
    lead: onboardingStrings.preferencesLead,
    canProceed: (ctx) => ctx.selectedSources.length > 0,
    nextLabel: () => onboardingStrings.finishAndSync,
    render: (ctx) => <PreferencesStep ctx={ctx} />
  },
  {
    id: "sync",
    title: onboardingStrings.syncHeading,
    lead: onboardingStrings.syncLead,
    // A failed source does not lock the user out: they can retry or enter and sync later.
    canProceed: (ctx) => ctx.setupSyncCompleted || ctx.syncFinished,
    nextLabel: () => onboardingStrings.enterApp,
    render: (ctx) => <SyncStep ctx={ctx} />
  }
];

/* ---------- Steps ---------- */

const featureIcons = [Search, Download, Tablet];

function WelcomeStep() {
  return (
    <>
      <ul className="onboarding-features">
        {onboardingStrings.welcomeFeatures.map((feature, index) => {
          const Icon = featureIcons[index] ?? BookOpenText;
          return (
            <li className="onboarding-features__item" key={feature.title}>
              <span className="onboarding-features__icon" aria-hidden="true"><Icon /></span>
              <strong>{feature.title}</strong>
              <span>{feature.text}</span>
            </li>
          );
        })}
      </ul>
      <p className="onboarding-hint">{onboardingStrings.welcomeHint}</p>
    </>
  );
}

function ServerStep({ ctx }: { ctx: StepContext }) {
  const probe = ctx.serverVerified ? ctx.serverProbe : null;
  const error = ctx.serverError ?? null;
  return (
    <div className="onboarding-stack">
      <div className="onboarding-inline">
        <TextField
          label={onboardingStrings.serverUrlLabel}
          type="url"
          inputMode="url"
          spellCheck={false}
          leading={<Globe2 />}
          placeholder={onboardingStrings.serverUrlPlaceholder}
          value={ctx.config.serverUrl}
          error={error}
          fieldClassName="onboarding-inline__grow"
          data-enter="verify"
          onChange={(event) => ctx.onChange({ serverUrl: event.target.value })}
        />
        <Button
          variant={probe ? "outline" : "primary"}
          icon={<RefreshCcw />}
          loading={ctx.probingServer}
          disabled={ctx.config.serverUrl.trim().length === 0}
          onClick={ctx.onValidateServer}
        >
          {ctx.probingServer ? onboardingStrings.validatingServer : onboardingStrings.validateServer}
        </Button>
      </div>

      <div className={cx("onboarding-status", probe && "onboarding-status--ok", error && "onboarding-status--error")} data-testid="onboarding-server-status" aria-live="polite">
        {probe ? (
          <>
            <div className="onboarding-status__head">
              <CheckCircle2 aria-hidden="true" />
              <strong>{probe.serverName}</strong>
              <Badge tone="success">{onboardingStrings.serverVerified}</Badge>
            </div>
            <dl className="onboarding-facts">
              <div><dt>{onboardingStrings.serverVersion}</dt><dd>{probe.version}</dd></div>
              <div><dt>{onboardingStrings.serverLatency}</dt><dd>{probe.latencyMs} ms</dd></div>
              <div><dt>{onboardingStrings.serverSources}</dt><dd>{onboardingStrings.sourcesAvailable(probe.sourceCount)}</dd></div>
            </dl>
          </>
        ) : (
          <div className="onboarding-status__head onboarding-status__head--muted">
            {error ? <CircleAlert aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            <span>{error ? onboardingStrings.validateFailed : onboardingStrings.serverNeedsCheck}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function FolderStep({ ctx }: { ctx: StepContext }) {
  const fallback = defaultAppConfig().outputPath;
  const empty = ctx.config.outputPath.trim().length === 0;
  return (
    <div className="onboarding-stack">
      <FolderField
        label={onboardingStrings.outputPathLabel}
        value={ctx.config.outputPath}
        placeholder={fallback}
        onChange={(outputPath) => ctx.onChange({ outputPath })}
        onPick={(outputPath) => ctx.onChange({ outputPath })}
        error={empty ? onboardingStrings.outputPathRequired : undefined}
        hint={onboardingStrings.defaultFolderHint(fallback)}
      />
      {ctx.config.outputPath !== fallback ? (
        <div>
          <Button variant="ghost" size="sm" onClick={() => ctx.onChange({ outputPath: fallback })}>
            {onboardingStrings.useDefaultFolder}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PreferencesStep({ ctx }: { ctx: StepContext }) {
  const sourcesHintId = useId();
  return (
    <div className="onboarding-stack onboarding-stack--loose">
      <FormatPicker
        label={onboardingStrings.formatsLabel}
        value={ctx.config.defaultFormats}
        onChange={(defaultFormats) => ctx.onChange({ defaultFormats })}
      />
      <fieldset className="onboarding-sources" aria-describedby={sourcesHintId}>
        <legend className="onboarding-sources__legend">{onboardingStrings.sourcesHeading}</legend>
        <p className={cx("onboarding-sources__hint", ctx.selectedSources.length === 0 && "is-error")} id={sourcesHintId}>
          {ctx.selectedSources.length === 0 ? onboardingStrings.sourcesRequired : onboardingStrings.sourcesHint}
        </p>
        <div className="onboarding-sources__list">
          {ctx.sources.map((source) => (
            <Switch
              key={source.id}
              className="onboarding-sources__item"
              label={source.name}
              description={onboardingStrings.sourceMeta(sourceDomain(source.baseUrl), source.count)}
              checked={ctx.config.enabledSourceIds.includes(source.id)}
              onChange={() => ctx.onToggleSource(source.id)}
            />
          ))}
        </div>
      </fieldset>
      <Switch
        className="onboarding-sources__item onboarding-sources__item--solo"
        label={onboardingStrings.syncOnLaunch}
        checked={ctx.config.syncOnLaunch}
        onChange={(syncOnLaunch) => ctx.onChange({ syncOnLaunch })}
      />
    </div>
  );
}

const syncTone = { pending: "neutral", syncing: "accent", done: "success", error: "danger" } as const;

function SyncStatusIcon({ status }: { status: SetupSyncEntry["status"] }) {
  if (status === "done") return <CheckCircle2 className="onboarding-sync__icon is-done" aria-hidden="true" />;
  if (status === "error") return <CircleAlert className="onboarding-sync__icon is-error" aria-hidden="true" />;
  if (status === "syncing") return <LoaderCircle className="onboarding-sync__icon is-running" aria-hidden="true" />;
  return <Clock3 className="onboarding-sync__icon" aria-hidden="true" />;
}

function SyncStep({ ctx }: { ctx: StepContext }) {
  const { selectedSources, setupSync } = ctx;
  const overall = selectedSources.length === 0
    ? 100
    : Math.round(selectedSources.reduce((total, source) => total + (setupSync[source.id]?.progress ?? 0), 0) / selectedSources.length);
  const heading = ctx.setupSyncCompleted
    ? onboardingStrings.syncDone
    : ctx.syncFailed
      ? onboardingStrings.syncFailed
      : ctx.setupSyncRunning
        ? onboardingStrings.syncRunning
        : onboardingStrings.syncPreparing;

  return (
    <div className="onboarding-stack">
      <div className="onboarding-sync__overall" aria-live="polite">
        <div className="onboarding-sync__overall-head">
          <strong>{heading}</strong>
          <span>{overall}%</span>
        </div>
        <ProgressBar label={onboardingStrings.syncOverall} value={overall} tone={ctx.syncFailed ? "danger" : ctx.setupSyncCompleted ? "success" : "accent"} />
        {ctx.syncFailed ? (
          <div className="onboarding-sync__retry">
            <span>{onboardingStrings.syncFailedHint}</span>
            {ctx.onRetrySync ? (
              <Button size="sm" icon={<RefreshCcw />} onClick={ctx.onRetrySync}>{onboardingStrings.retrySync}</Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <ul className="onboarding-sync__list" data-testid="onboarding-sync-list">
        {selectedSources.map((source) => {
          const state = setupSync[source.id] ?? { progress: 0, status: "pending" as const, detail: onboardingStrings.syncDetail.queued };
          return (
            <li className="onboarding-sync__row" key={source.id}>
              <SyncStatusIcon status={state.status} />
              <div className="onboarding-sync__text">
                <strong>{source.name}</strong>
                <small>{state.detail}</small>
              </div>
              <Badge tone={syncTone[state.status]}>{onboardingStrings.syncStatus[state.status]}</Badge>
              <ProgressBar
                className="onboarding-sync__bar"
                size="sm"
                label={onboardingStrings.syncSourceProgress(source.name)}
                value={state.progress}
                tone={state.status === "error" ? "danger" : state.status === "done" ? "success" : "accent"}
              />
            </li>
          );
        })}
      </ul>

      <section className="onboarding-summary" aria-labelledby="onboarding-summary-title">
        <h2 className="onboarding-summary__title" id="onboarding-summary-title">{onboardingStrings.summaryHeading}</h2>
        <dl className="onboarding-facts onboarding-facts--summary">
          <div><dt>{onboardingStrings.summaryServer}</dt><dd title={ctx.config.serverUrl}>{sourceDomain(ctx.config.serverUrl)}</dd></div>
          <div><dt>{onboardingStrings.summaryFolder}</dt><dd title={ctx.config.outputPath}>{ctx.config.outputPath}</dd></div>
          <div><dt>{onboardingStrings.summaryFormats}</dt><dd>{ctx.config.defaultFormats.join(", ")}</dd></div>
          <div><dt>{onboardingStrings.summarySources}</dt><dd>{selectedSources.map((source) => source.name).join(", ")}</dd></div>
        </dl>
      </section>
    </div>
  );
}

/* ---------- Wizard ---------- */

/**
 * First-run setup as a full-window welcome screen: a centered card over an accent
 * backdrop, a dot step indicator and a fixed Back/Next footer.
 * Keyboard: Enter advances (or verifies the server from its field), Esc goes back
 * (it does nothing on the first step), Tab is trapped inside the card.
 */
export function OnboardingWizard(props: OnboardingWizardProps) {
  const { open, step, config, sources, setupSync, setupSyncRunning, serverProbe } = props;
  const cardRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = useId();

  const index = Math.min(Math.max(step, 0), steps.length - 1);
  const definition = steps[index];
  const selectedSources = sources.filter((source) => config.enabledSourceIds.includes(source.id));
  const entries = selectedSources.map((source) => setupSync[source.id]);
  const syncFinished = !setupSyncRunning && entries.length > 0 && entries.every((entry) => entry && (entry.status === "done" || entry.status === "error"));
  const ctx: StepContext = {
    ...props,
    selectedSources,
    serverVerified: Boolean(serverProbe && serverProbe.serverUrl === config.serverUrl),
    syncFinished,
    syncFailed: syncFinished && entries.some((entry) => entry?.status === "error")
  };
  const canProceed = definition.canProceed(ctx);

  // Move focus into the step: its first text field, else the title (Enter still advances).
  useEffect(() => {
    if (!open) return;
    const card = cardRef.current;
    const field = card?.querySelector<HTMLInputElement>(".onboarding__body input:not([disabled])");
    (field ?? titleRef.current)?.focus();
  }, [open, index]);

  if (!open) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "Tab") {
      const focusable = getFocusable(cardRef.current);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      if (setupSyncRunning) return;
      if (index > 0) props.onBack();
      else if (props.allowClose) props.onClose();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
    // Buttons, switches and selects handle Enter themselves.
    if (target.closest("button, select, textarea, a")) return;
    event.preventDefault();
    if (target.dataset.enter === "verify" && !ctx.serverVerified) {
      props.onValidateServer();
      return;
    }
    if (canProceed) props.onNext();
  };

  const welcome = definition.id === "welcome";

  return (
    <div className="onboarding" data-testid="onboarding">
      <div className="onboarding__drag" data-tauri-drag-region aria-hidden="true" />
      <section
        ref={cardRef}
        className={cx("onboarding__card", welcome && "onboarding__card--welcome")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-lead`}
        onKeyDown={onKeyDown}
      >
        <header className="onboarding__top">
          <div className="onboarding__brand">
            <img src="/icons/oghma-icon.svg" alt="" draggable={false} />
            <span>{onboardingStrings.dialogLabel}</span>
          </div>
          <div className="onboarding__progress">
            <span className="onboarding__count" data-testid="onboarding-step">{onboardingStrings.stepOf(index + 1, steps.length)}</span>
            <ol className="onboarding__dots" aria-label={onboardingStrings.stepIndicator}>
              {onboardingStrings.steps.map((label, dot) => (
                <li
                  key={label}
                  className={cx("onboarding__dot", dot === index && "is-current", dot < index && "is-done")}
                  aria-current={dot === index ? "step" : undefined}
                >
                  <span className="sr-only">{label}</span>
                </li>
              ))}
            </ol>
          </div>
          {props.allowClose ? (
            <IconButton size="sm" label={onboardingStrings.close} icon={<X />} onClick={props.onClose} disabled={setupSyncRunning} />
          ) : null}
        </header>

        <div className="onboarding__body" key={definition.id}>
          {welcome ? <img className="onboarding__hero-logo" src="/icons/oghma-icon.svg" alt="" draggable={false} /> : null}
          {welcome ? null : <span className="onboarding__eyebrow">{onboardingStrings.steps[index]}</span>}
          <h2 className="onboarding__title" id={titleId} ref={titleRef} tabIndex={-1}>{definition.title}</h2>
          <p className="onboarding__lead" id={`${titleId}-lead`}>{definition.lead}</p>
          <div className="onboarding__content">{definition.render(ctx)}</div>
        </div>

        <footer className="onboarding__footer">
          <Button
            variant="ghost"
            icon={<ArrowLeft />}
            className={cx(index === 0 && "onboarding__back--hidden")}
            onClick={props.onBack}
            disabled={index === 0 || setupSyncRunning}
            aria-hidden={index === 0 ? true : undefined}
            tabIndex={index === 0 ? -1 : undefined}
          >
            {onboardingStrings.back}
          </Button>
          <Button
            variant="primary"
            size={welcome ? "lg" : "md"}
            iconRight={definition.id === "sync" ? undefined : <ArrowRight />}
            onClick={props.onNext}
            disabled={!canProceed}
          >
            {definition.nextLabel(ctx)}
          </Button>
        </footer>
      </section>
    </div>
  );
}
