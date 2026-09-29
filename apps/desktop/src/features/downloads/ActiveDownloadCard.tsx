import { BookOpen, Clock, Gauge, HardDriveDownload, Pause, Play, X } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import type { DownloadJob } from "../../core/types";
import { formatEta, formatSpeed } from "../../shell/format";
import { downloadsStrings, stageLabels } from "../../strings/downloads";
import { Button, Cover, cx, ProgressBar } from "../../ui";
import { describeJobProgress, describeRange, formatBytes } from "./format";
import { JobBadges } from "./JobBadges";
import { useAnimatedNumber } from "./useAnimatedNumber";

type ActiveDownloadCardProps = {
  job: DownloadJob;
  /** The queue is paused: the card shows the job that runs next, with a resume action. */
  paused: boolean;
  onPause: () => void;
  onResume: () => void;
  onCancel: (job: DownloadJob) => void;
};

function Stat({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <li className="downloads-stat" title={label}>
      <span className="downloads-stat__icon" aria-hidden="true">{icon}</span>
      <span className="sr-only">{label}: </span>
      <span className="downloads-stat__value">{children}</span>
    </li>
  );
}

/** Hero card for the running job: blurred cover backdrop, big percentage, 8px bar and live stats. */
export function ActiveDownloadCard({ job, paused, onPause, onResume, onCancel }: ActiveDownloadCardProps) {
  const { progress } = job;
  const percent = useAnimatedNumber(Math.max(0, Math.min(100, progress.percent)));
  const stage = paused ? downloadsStrings.paused : stageLabels[progress.stage] ?? progress.stage;
  const backdrop = job.coverUrl ? ({ backgroundImage: `url("${job.coverUrl}")` } as CSSProperties) : undefined;

  const stats: ReactNode[] = [];
  if (!paused) {
    if (progress.speedBps !== undefined && progress.speedBps > 0) {
      stats.push(<Stat key="speed" icon={<Gauge />} label={downloadsStrings.speed}>{formatSpeed(progress.speedBps)}</Stat>);
    }
    if (progress.etaSec !== undefined && progress.etaSec > 0) {
      stats.push(
        <Stat key="eta" icon={<Clock />} label={downloadsStrings.remainingLabel}>{downloadsStrings.remaining(formatEta(progress.etaSec))}</Stat>
      );
    }
    if (progress.bytesReceived !== undefined && progress.bytesReceived > 0) {
      stats.push(
        <Stat key="bytes" icon={<HardDriveDownload />} label={downloadsStrings.bytesLabel}>
          {downloadsStrings.bytes(formatBytes(progress.bytesReceived), progress.bytesTotal ? formatBytes(progress.bytesTotal) : undefined)}
        </Stat>
      );
    }
    if (progress.chaptersTotal) {
      stats.push(
        <Stat key="chapters" icon={<BookOpen />} label={downloadsStrings.chaptersLabel}>
          {downloadsStrings.chapters(progress.chaptersDone ?? 0, progress.chaptersTotal)}
        </Stat>
      );
    }
  }

  return (
    <article
      className={cx("downloads-hero", paused && "downloads-hero--paused", !job.coverUrl && "downloads-hero--no-cover")}
      data-testid={paused ? "download-paused" : "download-active"}
      data-status={job.status}
      aria-label={job.title}
    >
      <div className="downloads-hero__backdrop" style={backdrop} aria-hidden="true" />
      <div className="downloads-hero__scrim" aria-hidden="true" />
      <div className="downloads-hero__content" data-testid="queue-item">
        <Cover src={job.coverUrl} title={job.title} size="md" sheen className="downloads-hero__cover" />
        <div className="downloads-hero__main">
          <div className="downloads-hero__eyebrow">
            <span className={cx("downloads-hero__stage", paused && "is-paused")}>
              <span className="downloads-hero__pulse" aria-hidden="true" />
              {stage}
            </span>
            <JobBadges job={job} />
          </div>
          <strong className="downloads-hero__title" title={job.title}>{job.title}</strong>
          <span className="downloads-hero__range">{describeRange(job)}</span>

          <div className="downloads-hero__progress">
            <div className="downloads-hero__progress-head">
              <span className="downloads-hero__percent" aria-hidden="true">
                {Math.round(percent)}
                <span className="downloads-hero__percent-sign">%</span>
              </span>
              <div className="downloads-hero__actions">
                {paused ? (
                  <Button variant="primary" icon={<Play />} onClick={onResume}>{downloadsStrings.resume}</Button>
                ) : (
                  <Button variant="glass" icon={<Pause />} onClick={onPause}>{downloadsStrings.pause}</Button>
                )}
                <Button variant="glass" icon={<X />} onClick={() => onCancel(job)}>{downloadsStrings.cancel}</Button>
              </div>
            </div>
            <div data-testid="download-progress">
              <ProgressBar
                className="downloads-hero__bar"
                value={progress.percent}
                label={`${stage} ${job.title}`}
                valueText={paused ? `${downloadsStrings.paused} · ${Math.round(progress.percent)}%` : describeJobProgress(job)}
              />
            </div>
            {stats.length > 0 ? <ul className="downloads-stats">{stats}</ul> : null}
          </div>
        </div>
      </div>
    </article>
  );
}
