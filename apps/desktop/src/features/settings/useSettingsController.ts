import { useCallback, useRef, type Dispatch, type SetStateAction } from "react";
import { writeStoredConfig } from "../../core/appConfig";
import type { AppConfig } from "../../core/types";

type SettingsControllerArgs = {
  appConfig: AppConfig;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  /** Called when the server URL or index mode changes (invalidates a previous server probe). */
  onConnectionChanged: () => void;
  onOpenOnboarding: () => void;
  /** The backend is built once from the stored server URL: a new URL needs a fresh start
   *  (main.tsx reloads the window). Absent in tests, which inject their own backend. */
  onServerUrlChange?: () => void;
};

/** App configuration patching. Moved from App.tsx unchanged. */
export function useSettingsController({ appConfig, setAppConfig, onConnectionChanged, onOpenOnboarding, onServerUrlChange }: SettingsControllerArgs) {
  /** Server the backend was built with (the URL stored when the app started). */
  const startUrl = useRef(appConfig.serverUrl);

  const patchConfig = useCallback((patch: Partial<AppConfig>) => {
    if (onServerUrlChange && patch.serverUrl !== undefined && patch.serverUrl !== appConfig.serverUrl) {
      // Save first, then restart on the new server (catalog, search and sources all come from it).
      writeStoredConfig({ ...appConfig, ...patch });
      onServerUrlChange();
      return;
    }
    setAppConfig((current) => ({ ...current, ...patch }));
    if (Object.prototype.hasOwnProperty.call(patch, "serverUrl") || Object.prototype.hasOwnProperty.call(patch, "indexMode")) {
      onConnectionChanged();
    }
  }, [appConfig, onConnectionChanged, onServerUrlChange, setAppConfig]);

  /** Onboarding edits the URL as the user types: keep it in state, restart only at the end. */
  const patchConfigDraft = useCallback((patch: Partial<AppConfig>) => {
    setAppConfig((current) => ({ ...current, ...patch }));
    if (Object.prototype.hasOwnProperty.call(patch, "serverUrl") || Object.prototype.hasOwnProperty.call(patch, "indexMode")) {
      onConnectionChanged();
    }
  }, [onConnectionChanged, setAppConfig]);

  /** After onboarding: a server other than the one the app started with needs a fresh start. */
  const restartIfServerChanged = useCallback(() => {
    if (!onServerUrlChange || appConfig.serverUrl === startUrl.current) return;
    writeStoredConfig(appConfig);
    onServerUrlChange();
  }, [appConfig, onServerUrlChange]);

  return { config: appConfig, patchConfig, patchConfigDraft, restartIfServerChanged, openOnboarding: onOpenOnboarding };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
