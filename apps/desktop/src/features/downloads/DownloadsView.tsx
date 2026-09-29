import { Download, Inbox, Search } from "lucide-react";
import { useState } from "react";
import { useNavigation } from "../../app/NavigationContext";
import type { DownloadJob } from "../../core/types";
import type { MoveDirection } from "../../services/downloadQueue";
import { downloadsStrings } from "../../strings/downloads";
import { Button, ConfirmationModal, EmptyState, Section } from "../../ui";
import { ActiveDownloadCard } from "./ActiveDownloadCard";
import { CompletedList } from "./CompletedList";
import { QueueList } from "./QueueList";
import "./downloads.css";

export { describeJobProgress } from "./format";

export type DownloadsViewProps = {
  activeJob: DownloadJob | null;
  queuedJobs: DownloadJob[];
  completedJobs: DownloadJob[];
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  /** Cancels the active job (after confirmation) or drops a queued one. */
  onCancel: (id: string) => void;
  onMove: (id: string, direction: MoveDirection) => void;
  /** New run order of the queued jobs (ids). */
  onReorder: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onOpenFolder: (job: DownloadJob) => void;
};

export function DownloadsView({
  activeJob,
  queuedJobs,
  completedJobs,
  paused,
  onPause,
  onResume,
  onCancel,
  onMove,
  onReorder,
  onRemove,
  onRetry,
  onOpenFolder
}: DownloadsViewProps) {
  const { navigate } = useNavigation();
  const [confirmCancel, setConfirmCancel] = useState<DownloadJob | null>(null);

  const running = activeJob && activeJob.status !== "canceled" ? activeJob : null;
  // While paused, the job that runs next (the aborted one, back at the head of the queue) stays in the hero card.
  const heroJob = running ?? (paused ? queuedJobs[0] ?? null : null);
  const heroPaused = paused || running?.status === "paused";
  const heroFromQueue = Boolean(heroJob) && !running;
  const listed = heroFromQueue ? queuedJobs.slice(1) : queuedJobs;
  const offset = heroFromQueue ? 1 : 0;
  const pendingCount = (running ? 1 : 0) + queuedJobs.length;
  const goToDiscover = () => navigate("discover");

  const reorder = (next: DownloadJob[]) => {
    const ids = next.map((job) => job.id);
    onReorder(heroFromQueue && heroJob ? [heroJob.id, ...ids] : ids);
  };

  const confirmation = (
    <ConfirmationModal
      open={Boolean(confirmCancel)}
      onClose={() => setConfirmCancel(null)}
      onConfirm={() => {
        if (confirmCancel) onCancel(confirmCancel.id);
        setConfirmCancel(null);
      }}
      title={downloadsStrings.cancelConfirmTitle}
      description={downloadsStrings.cancelConfirmDescription}
      confirmLabel={downloadsStrings.cancelConfirm}
      cancelLabel={downloadsStrings.keepDownloading}
      tone="danger"
    />
  );

  if (pendingCount === 0 && completedJobs.length === 0 && !paused) {
    return (
      <div className="o-page o-page--narrow downloads-page downloads-page--empty">
        <EmptyState
          className="downloads-empty"
          icon={<Download />}
          title={downloadsStrings.emptyTitle}
          description={downloadsStrings.emptyDescription}
          action={<Button variant="primary" icon={<Search />} onClick={goToDiscover}>{downloadsStrings.goToDiscover}</Button>}
        />
        {confirmation}
      </div>
    );
  }

  return (
    <div className="o-page o-page--narrow downloads-page">
      <div className="downloads-pending" data-testid="downloads-pending">
        <Section title={downloadsStrings.pendingHeading} className="downloads-section">
          {heroJob ? (
            <ActiveDownloadCard
              key={heroJob.id}
              job={heroJob}
              paused={heroPaused}
              onPause={onPause}
              onResume={onResume}
              onCancel={setConfirmCancel}
            />
          ) : (
            <div className="downloads-idle">
              <span className="downloads-idle__icon" aria-hidden="true"><Inbox /></span>
              <div className="downloads-idle__text">
                <strong>{downloadsStrings.idleTitle}</strong>
                <span>{paused ? downloadsStrings.pausedIdle : downloadsStrings.idleDescription}</span>
              </div>
              <Button size="sm" variant="ghost" icon={<Search />} onClick={goToDiscover}>{downloadsStrings.goToDiscover}</Button>
            </div>
          )}
        </Section>

        {listed.length > 0 ? (
          <Section
            title={(
              <span className="downloads-section__title">
                {downloadsStrings.queuedHeading}
                <span className="downloads-section__count">{listed.length}</span>
              </span>
            )}
            description={downloadsStrings.queuedNote}
            className="downloads-section"
          >
            <QueueList
              jobs={listed}
              offset={offset}
              total={queuedJobs.length}
              onMove={onMove}
              onRemove={onRemove}
              onReorder={reorder}
            />
          </Section>
        ) : null}
      </div>

      {completedJobs.length > 0 ? (
        <div className="downloads-completed" data-testid="downloads-completed">
          <Section
            title={(
              <span className="downloads-section__title">
                {downloadsStrings.completedHeading}
                <span className="downloads-section__count">{completedJobs.length}</span>
              </span>
            )}
            className="downloads-section"
          >
            <CompletedList jobs={completedJobs} onRetry={onRetry} onRemove={onRemove} onOpenFolder={onOpenFolder} />
          </Section>
        </div>
      ) : null}
      {confirmation}
    </div>
  );
}
