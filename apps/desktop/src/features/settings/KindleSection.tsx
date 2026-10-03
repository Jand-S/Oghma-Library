import { ArrowRight, Cloud, Download, Usb, Wifi } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AppConfig, KindleDeviceStatus, KindleSendMethod } from "../../core/types";
import { getICloudStatus } from "../../services/localFiles";
import { settingsStrings } from "../../strings/settings";
import { Badge, Button, SegmentedControl, SelectField, TextField } from "../../ui";
import { openExternal } from "./appInfo";
import { toggleFormat } from "./FormatPicker";
import { DEFAULT_ICLOUD_FOLDER, normalizeICloudFolder, SEND_TO_KINDLE_URL, useIntegrationPreferences } from "./preferences";
import { SettingsGroup, SettingsRow, SwitchRow, useDraft, type Save, type Navigate } from "./settingsLayout";

export function KindleSection({
  config,
  save,
  saved,
  kindleConnected,
  kindleStatus,
  onNavigate
}: {
  config: AppConfig;
  save: Save;
  saved: () => void;
  kindleConnected: boolean;
  kindleStatus: KindleDeviceStatus | null;
  onNavigate: Navigate;
}) {
  const formatId = useId();
  const azw3 = config.defaultFormats.includes("AZW3");
  const wirelessSupported = Boolean(kindleStatus?.wirelessSupported);
  const [integrations, updateIntegrations] = useIntegrationPreferences();
  const connectedLabel = kindleStatus?.transport === "mtp" ? settingsStrings.kindleConnectedMtp : settingsStrings.kindleConnectedDisk;
  return (
    <>
      <SettingsGroup {...settingsStrings.groups.kindle}>
        <SettingsRow label={settingsStrings.kindleStatus} description={kindleConnected ? undefined : settingsStrings.kindleStatusHint} testId="kindle-status">
          <div className="settings-inline settings-inline--end">
            <Badge tone={kindleConnected ? "success" : "neutral"}>
              {kindleConnected ? connectedLabel : settingsStrings.kindleDisconnected}
            </Badge>
            <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => onNavigate("kindle")}>
              {settingsStrings.openKindle}
            </Button>
          </div>
        </SettingsRow>
        {wirelessSupported ? (
          <>
            <SettingsRow label={settingsStrings.sendToKindleApp} description={settingsStrings.sendToKindleAppHint} testId="send-to-kindle-status">
              <div className="settings-inline settings-inline--end">
                <Badge tone={kindleStatus?.wirelessAvailable ? "success" : "neutral"}>
                  {kindleStatus?.wirelessAvailable ? settingsStrings.sendToKindleInstalled : settingsStrings.sendToKindleMissing}
                </Badge>
                {kindleStatus?.wirelessAvailable ? null : (
                  <Button variant="ghost" size="sm" icon={<Download />} onClick={() => void openExternal(SEND_TO_KINDLE_URL)}>
                    {settingsStrings.sendToKindleDownload}
                  </Button>
                )}
              </div>
            </SettingsRow>
            <SettingsRow label={settingsStrings.kindleMethod} description={settingsStrings.kindleMethodHint}>
              <SegmentedControl<KindleSendMethod>
                aria-label={settingsStrings.kindleMethod}
                value={integrations.kindleMethod}
                onChange={(kindleMethod) => {
                  updateIntegrations({ kindleMethod });
                  saved();
                }}
                options={[
                  { value: "usb", label: settingsStrings.kindleMethodUsb, icon: <Usb /> },
                  { value: "wireless", label: settingsStrings.kindleMethodWireless, icon: <Wifi /> }
                ]}
              />
            </SettingsRow>
          </>
        ) : null}
        <SettingsRow label={settingsStrings.kindleFormat} labelId={`${formatId}-label`} htmlFor={formatId} description={settingsStrings.kindleFormatHint}>
          <SelectField
            id={formatId}
            label={settingsStrings.kindleFormat}
            hideLabel
            aria-labelledby={`${formatId}-label`}
            options={[{ value: "AZW3", label: settingsStrings.kindleFormatAzw3 }]}
            value="AZW3"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
        <SwitchRow
          label={settingsStrings.kindleAlwaysAzw3}
          description={settingsStrings.kindleAlwaysAzw3Hint}
          checked={azw3}
          onChange={(checked) => {
            if (checked === azw3) return;
            // Turning AZW3 off when it is the only format falls back to EPUB.
            const next = !checked && config.defaultFormats.length === 1 ? ["EPUB" as const] : toggleFormat(config.defaultFormats, "AZW3");
            save({ defaultFormats: next });
          }}
        />
      </SettingsGroup>
      {wirelessSupported ? (
        <ICloudGroup
          folder={integrations.icloudFolder}
          onFolderChange={(icloudFolder) => {
            updateIntegrations({ icloudFolder });
            saved();
          }}
        />
      ) : null}
    </>
  );
}

/** iCloud Drive (macOS): where "Salvar no iCloud" copies the EPUBs. */
function ICloudGroup({ folder, onFolderChange }: { folder: string; onFolderChange: (folder: string) => void }) {
  const folderId = useId();
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void getICloudStatus()
      .then((status) => {
        if (!cancelled) setAvailable(Boolean(status?.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const draft = useDraft(folder, () => null, (value) => onFolderChange(normalizeICloudFolder(value)));
  return (
    <SettingsGroup {...settingsStrings.groups.icloud}>
      <SettingsRow
        label={settingsStrings.icloudStatus}
        description={available === false ? settingsStrings.icloudOffHint : undefined}
        testId="icloud-status"
      >
        <Badge tone={available ? "success" : "neutral"}>
          {available === null ? settingsStrings.icloudChecking : available ? settingsStrings.icloudOn : settingsStrings.icloudOff}
        </Badge>
      </SettingsRow>
      <SettingsRow stacked label={settingsStrings.icloudFolder} labelId={`${folderId}-label`} htmlFor={folderId}>
        <TextField
          id={folderId}
          label={settingsStrings.icloudFolder}
          hideLabel
          aria-labelledby={`${folderId}-label`}
          spellCheck={false}
          leading={<Cloud />}
          value={draft.draft}
          placeholder={DEFAULT_ICLOUD_FOLDER}
          hint={settingsStrings.icloudFolderHint(normalizeICloudFolder(draft.draft))}
          onChange={(event) => draft.setDraft(event.target.value)}
          onBlur={() => void draft.flush()}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              draft.flush();
            }
          }}
        />
      </SettingsRow>
    </SettingsGroup>
  );
}
