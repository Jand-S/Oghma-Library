import { AlertCircle, FolderOpen, RotateCcw, X } from "lucide-react";
import type { DownloadJob } from "../../core/types";
import { downloadsStrings } from "../../strings/downloads";
import { Badge, Button, Cover, cx, IconButton } from "../../ui";
import { describeRange, formatFinishedAt } from "./format";
import { JobBadges } from "./JobBadges";

type CompletedListProps = {
  jobs: DownloadJob[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onOpenFolder: (job: DownloadJob) => void;
};

function StatusBadge({ job }: { job: DownloadJob }) {
  if (job.status === "done") return <Badge tone="success">{downloadsStrings.done}</Badge>;
  if (job.status === "error") return <Badge tone="danger">{downloadsStrings.failedBadge}</Badge>;
  return <Badge>{downloadsStrings.canceled}</Badge>;
}

function CompletedRow({ job, onRetry, onRemove, onOpenFolder }: Omit<CompletedListProps, "jobs"> & { job: DownloadJob }) {
  const done = job.status === "done";
  const failed = job.status === "error";
  const finishedAt = job.finishedAt ?? job.createdAt;
  return (
    <li className={cx("downloads-done-row", failed && "downloads-done-row--error", job.status === "canceled" && "downloads-done-row--canceled")} data-testid="download-row" data-status={job.status}>
      <Cover src={job.coverUrl} title={job.title} size="sm" className="downloads-thumb" />
      <div className="downloads-done-row__info" data-testid="queue-item">
        <span className="downloads-done-row__head">
          <strong className="downloads-row-title" title={job.title}>{job.title}</strong>
          <StatusBadge job={job} />
        </span>
        <span className="downloads-row-meta">
          <time className="downloads-row-meta__text" dateTime={new Date(finishedAt).toISOString()}>{formatFinishedAt(finishedAt)}</time>
          <span className="downloads-row-meta__dot" aria-hidden="true">·</span>
          <span className="downloads-row-meta__text">{describeRange(job)}</span>
          <JobBadges job={job} />
        </span>
        {failed ? (
          <span className="downloads-done-row__error">
            <AlertCircle aria-hidden="true" />
            <span>{job.error ?? downloadsStrings.failed}</span>
          </span>
        ) : null}
      </div>
      <div className="downloads-done-row__actions">
        {done && job.finalDir ? (
          <Button size="sm" variant="ghost" icon={<FolderOpen />} aria-label={downloadsStrings.openFolderLabel(job.title)} onClick={() => onOpenFolder(job)}>
            {downloadsStrings.openFolder}
          </Button>
        ) : null}
        {!done ? (
          <Button size="sm" variant="outline" icon={<RotateCcw />} aria-label={downloadsStrings.retryLabel(job.title)} onClick={() => onRetry(job.id)}>
            {downloadsStrings.retry}
          </Button>
        ) : null}
        <IconButton size="sm" label={downloadsStrings.removeFromList(job.title)} icon={<X />} onClick={() => onRemove(job.id)} />
      </div>
    </li>
  );
}

/** "Concluídos": failures first (they need attention), then finished and canceled jobs, newest first. */
export function CompletedList({ jobs, ...handlers }: CompletedListProps) {
  const failures = jobs.filter((job) => job.status === "error");
  const others = jobs.filter((job) => job.status !== "error");
  const grouped = failures.length > 0 && others.length > 0;

  const renderGroup = (list: DownloadJob[], title: string, tone: "danger" | "neutral") => (
    <div className="downloads-done-group">
      {grouped ? (
        <h3 className={cx("downloads-done-group__title", tone === "danger" && "downloads-done-group__title--danger")}>
          {title}
          <span className="downloads-done-group__count">{list.length}</span>
        </h3>
      ) : null}
      <ul className="downloads-done-list" aria-label={title}>
        {list.map((job) => <CompletedRow key={job.id} job={job} {...handlers} />)}
      </ul>
    </div>
  );

  return (
    <div className="downloads-done">
      {failures.length > 0 ? renderGroup(failures, downloadsStrings.failedGroup, "danger") : null}
      {others.length > 0 ? renderGroup(others, downloadsStrings.finishedGroup, "neutral") : null}
    </div>
  );
}
