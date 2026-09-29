import { ArrowDown, ArrowUp, ArrowUpToLine, MoreVertical, X } from "lucide-react";
import type { DownloadJob } from "../../core/types";
import type { MoveDirection } from "../../services/downloadQueue";
import { downloadsStrings } from "../../strings/downloads";
import { Badge, Cover, DropdownMenu, IconButton, SortableList } from "../../ui";
import { describeRange } from "./format";
import { JobBadges } from "./JobBadges";

type QueueListProps = {
  /** Jobs shown in the list, in run order. */
  jobs: DownloadJob[];
  /** Jobs before the first listed one in the store (1 when the paused head is shown in the hero card). */
  offset: number;
  /** Total jobs in the store queue, including the offset ones. */
  total: number;
  onMove: (id: string, direction: MoveDirection) => void;
  onRemove: (id: string) => void;
  /** Receives the listed jobs in their new order. */
  onReorder: (next: DownloadJob[]) => void;
};

/** "Na fila": compact rows, drag handle + Alt+↑/↓ reorder and a ⋮ menu per row. */
export function QueueList({ jobs, offset, total, onMove, onRemove, onReorder }: QueueListProps) {
  return (
    <SortableList
      aria-label={downloadsStrings.queueListLabel}
      className="downloads-queue"
      items={jobs}
      getId={(job) => job.id}
      getLabel={(job) => job.title}
      onReorder={onReorder}
      renderItem={(job, { index, handleProps }) => {
        const storeIndex = index + offset;
        const position = index + 1;
        return (
          <div className="downloads-queue-row" data-testid="download-queued" data-status={job.status}>
            <SortableList.Handle {...handleProps} />
            <span className="downloads-queue-row__position" aria-label={downloadsStrings.positionLabel(position)}>
              {position}
            </span>
            <Cover src={job.coverUrl} title={job.title} size="sm" className="downloads-thumb" />
            <div className="downloads-queue-row__info" data-testid="queue-item">
              <strong className="downloads-row-title" title={job.title}>{job.title}</strong>
              <span className="downloads-row-meta">
                <span className="downloads-row-meta__text">{describeRange(job)}</span>
                <JobBadges job={job} />
              </span>
            </div>
            {job.status === "paused" ? <Badge tone="warning">{downloadsStrings.paused}</Badge> : null}
            <DropdownMenu
              align="end"
              label={downloadsStrings.queueActions(job.title)}
              trigger={<IconButton size="sm" label={downloadsStrings.queueActions(job.title)} icon={<MoreVertical />} />}
              items={[
                { label: downloadsStrings.moveTop, icon: <ArrowUpToLine />, disabled: storeIndex === 0, onSelect: () => onMove(job.id, "top") },
                { label: downloadsStrings.moveUpItem, icon: <ArrowUp />, disabled: storeIndex === 0, onSelect: () => onMove(job.id, "up") },
                { label: downloadsStrings.moveDownItem, icon: <ArrowDown />, disabled: storeIndex >= total - 1, onSelect: () => onMove(job.id, "down") },
                { label: downloadsStrings.removeFromQueue, icon: <X />, danger: true, separatorBefore: true, onSelect: () => onRemove(job.id) }
              ]}
            />
          </div>
        );
      }}
    />
  );
}
