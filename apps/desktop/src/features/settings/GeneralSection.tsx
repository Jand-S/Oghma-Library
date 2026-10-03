import { useId } from "react";
import { navStrings } from "../../strings/common";
import { settingsStrings } from "../../strings/settings";
import { SelectField } from "../../ui";
import { startPages, useUiPreferences, type StartPage } from "./preferences";
import { SettingsGroup, SettingsRow } from "./settingsLayout";

export function GeneralSection({ saved }: { saved: () => void }) {
  const [preferences, updatePreferences] = useUiPreferences();
  const languageId = useId();
  const startId = useId();
  const themeId = useId();
  const startOptions = startPages.map((page) => ({ value: page, label: navStrings[page] }));

  return (
    <>
      <SettingsGroup {...settingsStrings.groups.locale}>
        <SettingsRow label={settingsStrings.language} labelId={`${languageId}-label`} htmlFor={languageId} description={settingsStrings.languageHint}>
          <SelectField
            id={languageId}
            label={settingsStrings.language}
            hideLabel
            aria-labelledby={`${languageId}-label`}
            options={[{ value: "pt-BR", label: settingsStrings.languagePtBr }]}
            value="pt-BR"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
        <SettingsRow label={settingsStrings.startPage} labelId={`${startId}-label`} htmlFor={startId} description={settingsStrings.startPageHint}>
          <SelectField<StartPage>
            id={startId}
            label={settingsStrings.startPage}
            hideLabel
            aria-labelledby={`${startId}-label`}
            options={startOptions}
            value={preferences.startPage}
            onChange={(event) => {
              updatePreferences({ startPage: event.target.value as StartPage });
              saved();
            }}
          />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup {...settingsStrings.groups.appearance}>
        <SettingsRow label={settingsStrings.theme} labelId={`${themeId}-label`} htmlFor={themeId} description={settingsStrings.themeHint}>
          <SelectField
            id={themeId}
            label={settingsStrings.theme}
            hideLabel
            aria-labelledby={`${themeId}-label`}
            options={[{ value: "dark", label: settingsStrings.themeDark }]}
            value="dark"
            disabled
            onChange={() => undefined}
          />
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
