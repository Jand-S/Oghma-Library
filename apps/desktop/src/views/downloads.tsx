import {
  ArrowDown,
  ArrowUp,
  FolderOpen,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  Trash2,
  X
} from "lucide-react";
import { useState } from "react";
import type { DownloadJob } from "../core/types";
import type { MoveDirection } from "../services/downloadQueue";
import { formatEta, formatSpeed } from "../shell/format";
import { downloadsStrings, stageLabels } from "../strings/downloads";
import { ConfirmationModal, IconButton, ProgressBar } from "../ui";

export type DownloadsViewProps = {
  activeJob: DownloadJob | null;
  queuedJobs: DownloadJob[];
  completedJobs: DownloadJob[];
  paused: boolean;
  onPauseToggle: () => void;
  /** Cancels the active job (after confirmation) or drops a queued one. */
  onCancel: (id: string) => void;
  onMove: (id: string, direction: MoveDirection) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onClearCompleted: () => void;
  onOpenFolder: (job: DownloadJob) => void;
};

function Thumb({ job }: { job: DownloadJob }) {
  return (
    <div
      className={`queue-thumb ${job.request.coverClass ?? "cover-c"}`}
      style={job.coverUrl ? { backgroundImage: `url("${job.coverUrl}")`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
    />
  );
}

/** "Baixando · 42% · 1,2 MB/s · 0:35" */
export function describeJobProgress(job: DownloadJob) {
  const { progress } = job;
  const parts: string[] = [stageLabels[progress.stage] ?? progress.stage, `${Math.round(progress.percent)}%`];
  if (progress.speedBps !== undefined && progress.speedBps > 0) parts.push(formatSpeed(progress.speedBps));
  if (progress.etaSec !== undefined && progress.etaSec > 0) parts.push(formatEta(progress.etaSec));
  if (progress.chaptersTotal) parts.push(`Cap. ${progress.chaptersDone ?? 0}/${progress.chaptersTotal.toLocaleString("pt-BR")}`);
  return parts.join(" · ");
}

export function DownloadsView({
  activeJob,
  queuedJobs,
  completedJobs,
  paused,
  onPauseToggle,
  onCancel,
  onMove,
  onRemove,
  onRetry,
  onClearCompleted,
  onOpenFolder
}: DownloadsViewProps) {
  const [confirmCancel, setConfirmCancel] = useState<DownloadJob | null>(null);
  const active = activeJob && activeJob.status !== "canceled" ? activeJob : null;
  const pendingCount = (active ? 1 : 0) + queuedJobs.length;

  return (
    <section className="page-area full-span">
      <div className="downloads-split">
        <section className="downloads-pane" data-testid="downloads-pending">
          <div className="pane-header">
            <div>
              <h3>{downloadsStrings.pendingHeading}</h3>
              <span>{downloadsStrings.itemCount(pendingCount)}{paused ? ` · ${downloadsStrings.paused}` : ""}</span>
            </div>
            <button className="button quiet" onClick={onPauseToggle} disabled={pendingCount === 0 && !paused}>
              {paused ? <Play size={15} /> : <Pause size={15} />}
              {paused ? downloadsStrings.resume : downloadsStrings.pause}
            </button>
          </div>
          <div className="download-table">
            {pendingCount === 0 ? (
              <div className="empty-state compact">{downloadsStrings.noPending}</div>
            ) : null}
            {active ? (
              <div data-testid="download-active" data-status={active.status}>
                <article className="download-row pending downloading" data-testid="queue-item">
                  <Thumb job={active} />
                  <div className="download-info">
                    <strong>{active.title}</strong>
                    <small>{active.request.rangeLabel}</small>
                    <ProgressBar
                      size="sm"
                      value={active.progress.percent}
                      label={`${stageLabels[active.progress.stage]} ${active.title}`}
                      valueText={describeJobProgress(active)}
                    />
                    <span className="download-meta" data-testid="download-progress">{describeJobProgress(active)}</span>
                  </div>
                  <button className="cancel-chip" onClick={() => setConfirmCancel(active)}>{downloadsStrings.cancel}</button>
                </article>
              </div>
            ) : null}
            {queuedJobs.map((job, index) => (
              <div data-testid="download-queued" data-status={job.status} key={job.id}>
                <article className={`download-row pending ${job.status}`} data-testid="queue-item">
                  <Thumb job={job} />
                  <div className="download-info">
                    <strong>{job.title}</strong>
                    <small>{job.request.rangeLabel}</small>
                    <span className="download-meta">
                      {job.status === "paused" ? downloadsStrings.paused : downloadsStrings.waiting} · #{index + 1}
                    </span>
                  </div>
                  <div className="pane-actions">
                    <IconButton
                      size="sm"
                      label={downloadsStrings.moveUp(job.title)}
                      icon={<ArrowUp />}
                      disabled={index === 0}
                      onClick={() => onMove(job.id, "up")}
                    />
                    <IconButton
                      size="sm"
                      label={downloadsStrings.moveDown(job.title)}
                      icon={<ArrowDown />}
                      disabled={index === queuedJobs.length - 1}
                      onClick={() => onMove(job.id, "down")}
                    />
                    <IconButton size="sm" label={downloadsStrings.remove(job.title)} icon={<X />} onClick={() => onRemove(job.id)} />
                  </div>
                </article>
              </div>
            ))}
          </div>
        </section>

        <section className="downloads-pane" data-testid="downloads-completed">
          <div className="pane-header">
            <div>
              <h3>{downloadsStrings.completedHeading}</h3>
              <span>{downloadsStrings.itemCount(completedJobs.length)}</span>
            </div>
            <div className="pane-actions">
              <button className="button quiet" onClick={onClearCompleted} disabled={completedJobs.length === 0}>
                <Trash2 size={15} />
                {downloadsStrings.clearCompleted}
              </button>
            </div>
          </div>
          <div className="download-table">
            {completedJobs.length === 0 ? (
              <div className="empty-state compact">{downloadsStrings.noCompleted}</div>
            ) : (
              completedJobs.map((job) => {
                const done = job.status === "done";
                return (
                  <div data-testid="download-row" data-status={job.status} key={job.id}>
                    <article className={`download-row pending ${done ? "done" : "error"}`} data-testid="queue-item">
                      <Thumb job={job} />
                      <div className="download-info">
                        <strong>{job.title}</strong>
                        <small>{job.request.rangeLabel}</small>
                        {done ? (
                          <div className="queue-badges">
                            {job.request.formats.map((format) => (
                              <span className="badge" key={format} title={job.outputFiles?.filter((file) => file.toLowerCase().endsWith(`.${format.toLowerCase()}`)).join(", ") || format}>{format}</span>
                            ))}
                            {job.request.audiobook ? <span className="badge accent"><Headphones size={11} /> Audiobook</span> : null}
                          </div>
                        ) : (
                          <span className="download-meta">
                            {job.status === "canceled" ? downloadsStrings.canceled : job.error ?? downloadsStrings.failed}
                          </span>
                        )}
                      </div>
                      <div className="pane-actions">
                        {done && job.finalDir ? (
                          <IconButton
                            size="sm"
                            label={downloadsStrings.openFolderLabel(job.title)}
                            icon={<FolderOpen />}
                            onClick={() => onOpenFolder(job)}
                          />
                        ) : null}
                        {!done ? (
                          <IconButton size="sm" label={downloadsStrings.retryLabel(job.title)} icon={<RotateCcw />} onClick={() => onRetry(job.id)} />
                        ) : null}
                        <IconButton size="sm" label={downloadsStrings.remove(job.title)} icon={<X />} onClick={() => onRemove(job.id)} />
                      </div>
                    </article>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
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
    </section>
  );
}
