import type { ServerProbe } from "../../core/types";
import { settingsStrings } from "../../strings/settings";
import { Badge, Spinner } from "../../ui";

export type ServerState = "unchecked" | "checking" | "online" | "failed";

/** Resolves the badge state for `serverUrl` from the last probe/error. */
export function serverStateFor(
  serverUrl: string,
  check: { probe: ServerProbe | null; checking: boolean; failedUrl?: string | null }
): ServerState {
  if (check.checking) return "checking";
  if (check.probe && check.probe.serverUrl.trim() === serverUrl.trim()) return "online";
  if (check.failedUrl && check.failedUrl.trim() === serverUrl.trim()) return "failed";
  return "unchecked";
}

/** Status badge for the index server ("Online · 42 ms", "Verificando…", ...). */
export function ServerStatusBadge({ state, probe }: { state: ServerState; probe: ServerProbe | null }) {
  if (state === "checking") {
    return (
      <Badge tone="accent" className="settings-status-badge">
        <Spinner size="sm" />
        {settingsStrings.serverChecking}
      </Badge>
    );
  }
  if (state === "online" && probe) return <Badge tone="success">{settingsStrings.serverOnline(probe.latencyMs)}</Badge>;
  if (state === "failed") return <Badge tone="danger">{settingsStrings.serverFailed}</Badge>;
  return <Badge tone="neutral">{settingsStrings.serverUnchecked}</Badge>;
}
