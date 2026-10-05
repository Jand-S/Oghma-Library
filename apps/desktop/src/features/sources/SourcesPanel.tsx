import { Plus, RefreshCcw } from "lucide-react";
import type { Novel } from "../../core/types";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button } from "../../ui";
import type { SourcesController } from "./useSourcesController";
import { SourcesView } from "./SourcesView";

/**
 * "Fontes" inside Ajustes: the summary and actions that used to sit in the Fontes page header,
 * over the sources table.
 */
export function SourcesPanel({ controller, novels, loading, onOpenSettings }: {
  controller: SourcesController;
  novels: Novel[];
  loading: boolean;
  onOpenSettings: () => void;
}) {
  const { sources, syncing } = controller;
  const enabled = sources.filter((source) => source.enabled);
  const anySyncing = enabled.some((source) => syncing.includes(source.id));
  return (
    <section className="sources-settings" aria-label={sourcesStrings.listLabel}>
      {sources.length ? (
        <div className="sources-settings__bar">
          <Badge>{sourcesStrings.summary(sources.length, enabled.length)}</Badge>
          <div className="sources-settings__actions">
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
          </div>
        </div>
      ) : null}
      <SourcesView
        sources={sources}
        syncing={syncing}
        loading={loading}
        novels={novels}
        onToggle={controller.toggleSourceEnabled}
        onSync={controller.syncSource}
        onAddSource={controller.addSource}
        onPeekSources={controller.peekIndexSources}
        onNotify={controller.notify}
        onOpenSettings={onOpenSettings}
        requestOpen={controller.requestOpen}
        onRequestOpenChange={controller.setRequestOpen}
      />
    </section>
  );
}
