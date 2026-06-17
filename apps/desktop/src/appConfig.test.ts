import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultAppConfig,
  normalizeStoredAppConfig,
  readStoredConfig,
  resolveAppConfig,
  setupStorageKey
} from "./appConfig";

describe("appConfig", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("filters unsupported fields from stored config payloads", () => {
    const normalized = normalizeStoredAppConfig({
      serverUrl: "http://127.0.0.1:8000",
      enabledSourceIds: ["central-novel", 42],
      indexMode: "incremental_recent",
      defaultFormats: ["EPUB", "INVALID"],
      translationEngine: "local",
      ttsSpeed: 1.2
    });

    expect(normalized).toEqual({
      serverUrl: "http://127.0.0.1:8000",
      enabledSourceIds: ["central-novel"],
      indexMode: "incremental_recent",
      defaultFormats: ["EPUB"],
      translationEngine: "local",
      ttsSpeed: 1.2
    });
  });

  it("merges partial stored configs with defaults and fallback sources", () => {
    const resolved = resolveAppConfig(
      {
        serverUrl: "http://127.0.0.1:8000",
        enabledSourceIds: [],
        defaultFormats: []
      },
      ["central-novel", "novel-mania"]
    );

    expect(resolved.serverUrl).toBe("http://127.0.0.1:8000");
    expect(resolved.enabledSourceIds).toEqual(["central-novel", "novel-mania"]);
    expect(resolved.defaultFormats).toEqual(["EPUB"]);
    expect(resolved.outputPath).toBe(defaultAppConfig().outputPath);
  });

  it("returns null for malformed persisted JSON", () => {
    window.localStorage.setItem(setupStorageKey, "{bad-json");

    expect(readStoredConfig()).toBeNull();
  });
});
