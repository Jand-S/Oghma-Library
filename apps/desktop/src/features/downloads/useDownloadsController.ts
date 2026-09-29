import { useCallback, useMemo, useState } from "react";
import { useDownloadQueue } from "../../app/useDownloadQueue";
import type { AppConfig, DownloadJob, EnqueueResult, QueueItem } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { downloadInputFromQueueItem, type DownloadQueue } from "../../services/downloadQueue";
import { openLocalPath } from "../../services/localFiles";
import type { ActiveDownload } from "../../shell";
import { downloadsStrings } from "../../strings/downloads";
import type { ToastOptions } from "../../ui";

/** Opens a folder in the OS file manager, or explains where it is when running in a browser. */
export function openOutputFolder(path: string, label: string, notify: (message: string) => void) {
  void openLocalPath(path)
    .then((opened) => {
      notify(opened ? downloadsStrings.openingFolder(label) : downloadsStrings.folderInBrowser(path));
    })
    .catch((error: unknown) => {
      notify(getErrorMessage(error, downloadsStrings.folderOpenFailed(label)));
    });
}

type DownloadsControllerArgs = {
  appConfig: AppConfig;
  queue: DownloadQueue;
  notify: (message: string) => void;
  toast: (options: ToastOptions) => void;
};

/**
 * Download queue state (one active job + a short reorderable queue) and its actions.
 * The queue store (services/downloadQueue) runs the jobs; this hook only exposes its
 * snapshot to React and wraps actions with user feedback.
 */
export function useDownloadsController({ appConfig, queue, notify, toast }: DownloadsControllerArgs) {
  const snapshot = useDownloadQueue(queue);
  const [pulse, setPulse] = useState(0);
  const flash = useCallback(() => setPulse((value) => value + 1), []);

  /**
   * Enqueues a download shaped by backend.createDownloads (bundleKey, range…) and
   * reports the result: added (started / queued), duplicate or full.
   */
  const enqueueDownload = useCallback((item: QueueItem): EnqueueResult => {
    const current = queue.getSnapshot();
    const idle = !current.active && current.queued.length === 0 && !current.paused;
    const outcome = queue.enqueue(downloadInputFromQueueItem(item, appConfig));
    if (outcome.result === "added") {
      flash();
      toast({ message: idle ? downloadsStrings.started : downloadsStrings.added, tone: "success" });
    } else if (outcome.result === "duplicate") {
      toast({ message: downloadsStrings.duplicate, tone: "warning" });
    } else {
      toast({ message: downloadsStrings.full, tone: "warning" });
    }
    return outcome;
  }, [appConfig, flash, queue, toast]);

  const clearCompleted = useCallback(() => {
    const count = queue.getSnapshot().completed.length;
    if (count === 0) return;
    queue.clearCompleted();
    notify(downloadsStrings.clearedToast(count));
  }, [notify, queue]);

  const retry = useCallback((id: string) => {
    const outcome = queue.retry(id);
    if (!outcome) return;
    if (outcome.result === "duplicate") toast({ message: downloadsStrings.duplicate, tone: "warning" });
    else if (outcome.result === "full") toast({ message: downloadsStrings.full, tone: "warning" });
  }, [queue, toast]);

  const openJobFolder = useCallback((job: DownloadJob) => {
    const dir = job.finalDir ?? job.request.sourceDir;
    if (!dir) return;
    openOutputFolder(dir, downloadsStrings.folderLabel(job.title), notify);
  }, [notify]);

  const { active: activeJob, queued: queuedJobs, completed: completedJobs, paused } = snapshot;

  /** Summary for the BottomPanel status line. */
  const active = useMemo<ActiveDownload | null>(() => {
    if (!activeJob || activeJob.status === "canceled" || activeJob.status === "paused") return null;
    return {
      title: activeJob.title,
      progress: activeJob.progress.percent,
      speedBps: activeJob.progress.speedBps,
      etaSec: activeJob.progress.etaSec
    };
  }, [activeJob]);

  return {
    /** Running job (downloading/converting/saving), or null. */
    activeJob,
    /** Jobs waiting, in run order. */
    queuedJobs,
    /** Finished jobs (done, error, canceled), newest first. */
    completedJobs,
    paused,
    pause: queue.pause,
    resume: queue.resume,
    togglePaused: () => (paused ? queue.resume() : queue.pause()),
    cancel: queue.cancel,
    move: queue.move,
    reorder: queue.reorder,
    remove: queue.remove,
    retry,
    clearCompleted,
    openJobFolder,
    enqueueDownload,
    isQueued: snapshot.isQueued,
    active,
    queuedCount: queuedJobs.length,
    downloading: Boolean(active) || (queuedJobs.length > 0 && !paused),
    pulse,
    flash
  };
}

export type DownloadsController = ReturnType<typeof useDownloadsController>;
