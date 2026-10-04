import { Plus, RefreshCcw } from "lucide-react";
import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button } from "../../ui";

/** Fontes' PageHeader content: "N fontes · M ativas", "Solicitar nova fonte" and "Sincronizar ativas". */
export function sourcesHeader({ sources: controller }: AppControllers): ViewHeader {
  const { sources, syncing } = controller;
  if (sources.length === 0) return {};
  const enabled = sources.filter((source) => source.enabled);
  const anySyncing = enabled.some((source) => syncing.includes(source.id));
  return {
    badge: <Badge>{sourcesStrings.summary(sources.length, enabled.length)}</Badge>,
    actions: (
      <>
        <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => controller.setRequestOpen(true)} data-testid="request-source-open">
          {sourcesStrings.request.open}
        </Button>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCcw />}
          loading={anySyncing}
          disabled={enabled.length === 0}
          onClick={() => void controller.syncEnabledSources()}
        >
          {sourcesStrings.syncAll}
        </Button>
      </>
    )
  };
}
