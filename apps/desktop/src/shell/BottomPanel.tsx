import { Download } from "lucide-react";
import { kindleStrings, shellStrings } from "../strings/common";
import { cx, ProgressBar } from "../ui";
import { formatEta, formatSpeed } from "./format";
import "./BottomPanel.css";

export type ActiveDownload = {
  title: string;
  /** 0–100. */
  progress: number;
  speedBps?: number;
  etaSec?: number;
};

export type KindleSummary = {
  connected: boolean;
  deviceName?: string;
  mountPath?: string;
} | null;

export type BottomPanelProps = {
  active?: ActiveDownload | null;
  queuedCount: number;
  kindle: KindleSummary;
  onOpenDownloads: () => void;
};

/** "Baixando {title}… 42% · 1,2 MB/s · 0:35" */
export function describeActiveDownload(active: ActiveDownload) {
  const parts = [`${shellStrings.downloading(active.title)} ${Math.round(active.progress)}%`];
  if (active.speedBps !== undefined && active.speedBps > 0) parts.push(formatSpeed(active.speedBps));
  if (active.etaSec !== undefined && active.etaSec > 0) parts.push(formatEta(active.etaSec));
  return parts.join(" · ");
}

export function BottomPanel({ active, queuedCount, kindle, onOpenDownloads }: BottomPanelProps) {
  const connected = kindle?.connected ?? false;
  const status = active ? describeActiveDownload(active) : shellStrings.idle;
  const kindleTitle = connected && kindle?.deviceName
    ? `${kindle.deviceName}${kindle.mountPath ? ` - ${kindle.mountPath}` : ""}`
    : kindleStrings.disconnected;

  return (
    <footer className="o-bottom-panel o-app__bottom" data-testid="bottom-panel">
      <button type="button" className="o-bottom-panel__downloads" onClick={onOpenDownloads} title={shellStrings.openDownloads}>
        <Download className={cx("o-bottom-panel__icon", active && "is-active")} aria-hidden="true" />
        <span className="o-bottom-panel__status">{status}</span>
        {active ? (
          <ProgressBar className="o-bottom-panel__progress" size="sm" value={active.progress} label={shellStrings.downloadsActive} />
        ) : null}
        {queuedCount > 0 ? <span className="o-bottom-panel__queued">{shellStrings.queued(queuedCount)}</span> : null}
      </button>
      <div className="o-bottom-panel__right">
        <span className="o-bottom-panel__kindle" title={kindleTitle} data-testid="bottom-panel-kindle" data-connected={connected}>
          <span className={cx("o-bottom-panel__dot", connected && "is-online")} aria-hidden="true" />
          <span>{connected ? kindleStrings.connected : kindleStrings.disconnected}</span>
        </span>
      </div>
    </footer>
  );
}
