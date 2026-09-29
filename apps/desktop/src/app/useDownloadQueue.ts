import { useMemo, useSyncExternalStore } from "react";
import type { DownloadJob, DownloadQueueSnapshot } from "../core/types";
import { getDownloadQueue, type DownloadQueue } from "../services/downloadQueue";

export type UseDownloadQueueResult = DownloadQueueSnapshot & {
  enqueue: DownloadQueue["enqueue"];
  cancel: DownloadQueue["cancel"];
  pause: DownloadQueue["pause"];
  resume: DownloadQueue["resume"];
  move: DownloadQueue["move"];
  reorder: DownloadQueue["reorder"];
  retry: DownloadQueue["retry"];
  remove: DownloadQueue["remove"];
  clearCompleted: DownloadQueue["clearCompleted"];
  /** Active + queued count. */
  pendingCount: number;
  /** True when the novel is active or waiting in the queue. */
  isQueued: (novelId: string) => boolean;
  /** The active or queued job for the novel, if any. */
  activeFor: (novelId: string) => DownloadJob | undefined;
};

export function useDownloadQueue(queue: DownloadQueue = getDownloadQueue()): UseDownloadQueueResult {
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot, queue.getSnapshot);
  return useMemo(() => {
    const pending = [...(snapshot.active && snapshot.active.status !== "canceled" ? [snapshot.active] : []), ...snapshot.queued];
    const byNovel = new Map(pending.map((job) => [job.novelId, job]));
    return {
      ...snapshot,
      enqueue: queue.enqueue,
      cancel: queue.cancel,
      pause: queue.pause,
      resume: queue.resume,
      move: queue.move,
      reorder: queue.reorder,
      retry: queue.retry,
      remove: queue.remove,
      clearCompleted: queue.clearCompleted,
      pendingCount: pending.length,
      isQueued: (novelId: string) => byNovel.has(novelId),
      activeFor: (novelId: string) => byNovel.get(novelId)
    };
  }, [queue, snapshot]);
}
