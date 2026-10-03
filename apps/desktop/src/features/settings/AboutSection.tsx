import { ExternalLink, Github, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { settingsLinks, settingsStrings } from "../../strings/settings";
import { Badge, Button, ConfirmationModal } from "../../ui";
import { fallbackAppVersion, getAppVersion, openExternal } from "./appInfo";
import { SettingsGroup, SettingsRow } from "./settingsLayout";

export function AboutSection({ onOpenOnboarding }: { onOpenOnboarding: () => void }) {
  const [version, setVersion] = useState(fallbackAppVersion);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let alive = true;
    void getAppVersion().then((value) => {
      if (alive) setVersion(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <>
      <div className="settings-about">
        <img className="settings-about__logo" src="/icons/oghma-icon.svg" alt="" draggable={false} />
        <div className="settings-about__text">
          <div className="settings-about__title">
            <strong>{settingsStrings.appName}</strong>
            <Badge tone="accent" data-testid="app-version">{settingsStrings.version(version)}</Badge>
          </div>
          <p>{settingsStrings.tagline}</p>
          <div className="settings-about__links">
            <Button size="sm" icon={<Github />} onClick={() => void openExternal(settingsLinks.repo)}>
              {settingsStrings.github}
            </Button>
            <Button size="sm" variant="ghost" icon={<ExternalLink />} onClick={() => void openExternal(settingsLinks.issues)}>
              {settingsStrings.reportIssue}
            </Button>
          </div>
        </div>
      </div>

      <SettingsGroup {...settingsStrings.groups.setup}>
        <SettingsRow label={settingsStrings.setupWizard} description={settingsStrings.rerunSetupHint}>
          <Button icon={<RotateCcw />} onClick={() => setConfirming(true)}>
            {settingsStrings.rerunSetup}
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <ConfirmationModal
        open={confirming}
        title={settingsStrings.rerunSetupConfirmTitle}
        description={settingsStrings.rerunSetupConfirmDescription}
        confirmLabel={settingsStrings.rerunSetupConfirm}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onOpenOnboarding();
        }}
      />
    </>
  );
}
