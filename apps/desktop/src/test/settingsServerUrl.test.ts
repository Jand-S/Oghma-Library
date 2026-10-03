import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { defaultAppConfig, readStoredConfig } from "../core/appConfig";
import type { AppConfig } from "../core/types";
import { useSettingsController } from "../features/settings/useSettingsController";

function setup(onServerUrlChange?: () => void) {
  return renderHook(() => {
    const [appConfig, setAppConfig] = useState<AppConfig>({ ...defaultAppConfig(), serverUrl: "https://old.example" });
    return useSettingsController({ appConfig, setAppConfig, onConnectionChanged: vi.fn(), onOpenOnboarding: vi.fn(), onServerUrlChange });
  });
}

describe("server URL change", () => {
  it("saves the new URL and restarts the app on it (the backend is built from the stored URL)", () => {
    const restart = vi.fn();
    const { result } = setup(restart);
    act(() => result.current.patchConfig({ serverUrl: "https://new.example" }));
    expect(restart).toHaveBeenCalledTimes(1);
    expect(readStoredConfig()?.serverUrl).toBe("https://new.example");
  });

  it("onboarding edits the URL without restarting on each keystroke, and restarts once at the end", () => {
    const restart = vi.fn();
    const { result } = setup(restart);
    act(() => result.current.patchConfigDraft({ serverUrl: "https://n" }));
    act(() => result.current.patchConfigDraft({ serverUrl: "https://new.example" }));
    expect(restart).not.toHaveBeenCalled();
    act(() => result.current.restartIfServerChanged());
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("other settings and an unchanged URL never restart", () => {
    const restart = vi.fn();
    const { result } = setup(restart);
    act(() => result.current.patchConfig({ serverUrl: "https://old.example", outputPath: "~/Livros" }));
    act(() => result.current.restartIfServerChanged());
    expect(restart).not.toHaveBeenCalled();
    expect(result.current.config.outputPath).toBe("~/Livros");
  });
});
