import { Pause, Play, Trash2 } from "lucide-react";
import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { downloadsStrings } from "../../strings/downloads";
import { Badge, Button } from "../../ui";

/** Active (not canceled) job plus the waiting ones. */
export function pendingCountOf({ activeJob, queuedJobs }: Pick<AppControllers["downloads"], "activeJob" | "queuedJobs">) {
  return (activeJob && activeJob.status !== "canceled" ? 1 : 0) + queuedJobs.length;
}

/** Downloads' PageHeader content: pending count, paused state and the queue-wide actions. */
export function downloadsHeader({ downloads }: AppControllers): ViewHeader {
  const pendingCount = pendingCountOf(downloads);
  const completedCount = downloads.completedJobs.length;
  if (pendingCount === 0 && completedCount === 0 && !downloads.paused) return {};
  return {
    badge: (
      <>
        <Badge tone={pendingCount > 0 ? "accent" : "neutral"} data-testid="downloads-count">
          {downloadsStrings.pendingCount(pendingCount)}
        </Badge>
        {downloads.paused ? (
          <Badge tone="warning">
            <Pause aria-hidden="true" />
            {downloadsStrings.queuePaused}
          </Badge>
        ) : null}
      </>
    ),
    actions: (
      <>
        {downloads.paused ? (
          <Button size="sm" variant="outline" icon={<Play />} onClick={downloads.resume}>{downloadsStrings.resumeQueue}</Button>
        ) : (
          <Button size="sm" variant="outline" icon={<Pause />} onClick={downloads.pause} disabled={pendingCount === 0}>
            {downloadsStrings.pauseQueue}
          </Button>
        )}
        <Button size="sm" variant="ghost" icon={<Trash2 />} onClick={downloads.clearCompleted} disabled={completedCount === 0}>
          {downloadsStrings.clearCompleted}
        </Button>
      </>
    )
  };
}
