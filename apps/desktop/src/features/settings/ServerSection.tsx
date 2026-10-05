import { Globe2, RefreshCcw } from "lucide-react";
import { useId } from "react";
import type { AppConfig, IndexMode, SourceSite } from "../../core/types";
import { onboardingStrings } from "../../strings/onboarding";
import { settingsStrings } from "../../strings/settings";
import { Button, TextField } from "../../ui";
import { formatSyncTime } from "../sources/lastSync";
import type { ServerCheck } from "../sources/useSourcesController";
import { serverStateFor, ServerStatusBadge } from "./ServerStatusBadge";
import { SettingsGroup, SettingsRow, useDraft, validateServerUrl, type Save } from "./settingsLayout";

export function ServerSection({
  config,
  save,
  sources,
  syncingSourceIds,
  lastSyncedAt,
  onSyncSources,
  serverCheck,
  onVerifyServer
}: {
  config: AppConfig;
  save: Save;
  sources: SourceSite[];
  syncingSourceIds: string[];
  lastSyncedAt: number | null;
  onSyncSources: () => Promise<boolean>;
  serverCheck: ServerCheck;
  onVerifyServer: (serverUrl: string, indexMode: IndexMode) => void;
}) {
  const urlId = useId();
  const server = useDraft(config.serverUrl, validateServerUrl, (serverUrl) => save({ serverUrl }));
  const state = serverStateFor(config.serverUrl, { probe: serverCheck.probe, checking: serverCheck.checking, failedUrl: serverCheck.errorUrl });
  const probe = state === "online" ? serverCheck.probe : null;
  const enabled = sources.filter((source) => source.enabled);
  const syncing = syncingSourceIds.length > 0;

  const verify = () => {
    const url = server.flush();
    if (url) onVerifyServer(url, config.indexMode);
  };

  const fieldError = server.error ?? (state === "failed" ? serverCheck.error : null);

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.server}>
        <SettingsRow stacked label={settingsStrings.serverUrl} labelId={`${urlId}-label`} htmlFor={urlId}>
          <div className="settings-inline">
            <TextField
              id={urlId}
              label={settingsStrings.serverUrl}
              hideLabel
              aria-labelledby={`${urlId}-label`}
              type="url"
              inputMode="url"
              spellCheck={false}
              leading={<Globe2 />}
              value={server.draft}
              hint={settingsStrings.serverUrlHint}
              error={fieldError}
              fieldClassName="settings-inline__grow"
              onChange={(event) => server.setDraft(event.target.value)}
              onBlur={() => void server.flush()}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  verify();
                }
              }}
            />
            <Button icon={<RefreshCcw />} loading={serverCheck.checking} onClick={verify} disabled={!server.draft.trim()}>
              {onboardingStrings.validateServer}
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow label={settingsStrings.serverStatus} description={probe ? settingsStrings.serverDetails(probe.serverName, probe.version, probe.sourceCount) : undefined} testId="server-status">
          <ServerStatusBadge state={state} probe={probe} />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.sync}>
        <SettingsRow
          label={settingsStrings.lastSync}
          description={enabled.length > 0 ? settingsStrings.enabledSources(enabled.length, sources.length) : settingsStrings.noEnabledSources}
          testId="last-sync"
        >
          <div className="settings-inline settings-inline--end">
            <span className="settings-value">{lastSyncedAt ? formatSyncTime(lastSyncedAt) : settingsStrings.lastSyncNever}</span>
            <Button icon={<RefreshCcw />} loading={syncing} disabled={enabled.length === 0} onClick={() => void onSyncSources()}>
              {settingsStrings.syncNow}
            </Button>
          </div>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
