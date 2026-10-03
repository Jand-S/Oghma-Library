import { ArrowRight } from "lucide-react";
import { useId } from "react";
import type { AppConfig, ChapterPreset } from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { setExportRoot } from "../../services/localFiles";
import { settingsStrings } from "../../strings/settings";
import { Button, SegmentedControl, useToast } from "../../ui";
import { FolderField } from "./FolderField";
import { FormatPicker } from "./FormatPicker";
import { useUiPreferences } from "./preferences";
import { SettingsGroup, SettingsRow, useDraft, validateFolder, type Save, type Navigate } from "./settingsLayout";

export function DownloadsSection({ config, save, saved, onNavigate }: { config: AppConfig; save: Save; saved: () => void; onNavigate: Navigate }) {
  const [preferences, updatePreferences] = useUiPreferences();
  const folderId = useId();
  const { toast } = useToast();
  // A typed folder only becomes the output root if Rust accepts it (missing, empty or an Oghma library).
  const folder = useDraft(config.outputPath, validateFolder, (outputPath) => {
    void setExportRoot(outputPath)
      .then(() => save({ outputPath }))
      .catch((err: unknown) => toast({ message: getErrorMessage(err, settingsStrings.outputPathRefused), tone: "danger" }));
  });

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.folder}>
        <SettingsRow stacked label={settingsStrings.outputPath} labelId={`${folderId}-label`} htmlFor={folderId}>
          <FolderField
            id={folderId}
            label={settingsStrings.outputPath}
            hideLabel
            labelledBy={`${folderId}-label`}
            value={folder.draft}
            onChange={folder.setDraft}
            onCommit={() => void folder.flush()}
            onPick={(outputPath) => save({ outputPath })}
            hint={settingsStrings.outputPathHint}
            error={folder.error}
            showOpen
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.downloadDefaults}>
        <SettingsRow stacked label={settingsStrings.defaultFormats}>
          <FormatPicker
            label={settingsStrings.defaultFormats}
            hideLabel
            hint={settingsStrings.defaultFormatsHint}
            value={config.defaultFormats}
            onChange={(defaultFormats) => save({ defaultFormats })}
          />
        </SettingsRow>
        <SettingsRow label={settingsStrings.chapterPreset} description={settingsStrings.chapterPresetHint}>
          <SegmentedControl<ChapterPreset>
            aria-label={settingsStrings.chapterPreset}
            value={preferences.chapterPreset}
            onChange={(chapterPreset) => {
              updatePreferences({ chapterPreset });
              saved();
            }}
            options={[
              { value: "all", label: settingsStrings.chapterPresets.all },
              { value: "range", label: settingsStrings.chapterPresets.range }
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup {...settingsStrings.groups.queue}>
        <div className="settings-note">
          <div className="settings-note__text">
            <strong>{settingsStrings.queueNoteTitle}</strong>
            <p>{settingsStrings.queueNote}</p>
          </div>
          <Button variant="ghost" size="sm" iconRight={<ArrowRight />} onClick={() => onNavigate("downloads")}>
            {settingsStrings.openDownloads}
          </Button>
        </div>
      </SettingsGroup>
    </>
  );
}
