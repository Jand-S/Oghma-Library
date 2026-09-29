import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AppConfig } from "../../core/types";

type SettingsControllerArgs = {
  appConfig: AppConfig;
  setAppConfig: Dispatch<SetStateAction<AppConfig>>;
  /** Called when the server URL or index mode changes (invalidates a previous server probe). */
  onConnectionChanged: () => void;
  onOpenOnboarding: () => void;
};

/** App configuration patching. Moved from App.tsx unchanged. */
export function useSettingsController({ appConfig, setAppConfig, onConnectionChanged, onOpenOnboarding }: SettingsControllerArgs) {
  const patchConfig = useCallback((patch: Partial<AppConfig>) => {
    setAppConfig((current) => ({ ...current, ...patch }));
    if (Object.prototype.hasOwnProperty.call(patch, "serverUrl") || Object.prototype.hasOwnProperty.call(patch, "indexMode")) {
      onConnectionChanged();
    }
  }, [onConnectionChanged, setAppConfig]);

  return { config: appConfig, patchConfig, openOnboarding: onOpenOnboarding };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
