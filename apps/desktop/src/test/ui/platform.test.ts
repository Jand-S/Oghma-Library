import { afterEach, describe, expect, it, vi } from "vitest";

const window$ = vi.hoisted(() => ({
  fullscreen: false,
  onResized: null as null | (() => void),
  unlisten: vi.fn()
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isFullscreen: () => Promise.resolve(window$.fullscreen),
    onResized: (handler: () => void) => {
      window$.onResized = handler;
      return Promise.resolve(window$.unlisten);
    }
  })
}));

import { watchFullscreen } from "../../shell/platform";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const root = document.documentElement;

describe("watchFullscreen", () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    delete root.dataset.fullscreen;
    window$.fullscreen = false;
    window$.onResized = null;
  });

  it("is a no-op outside Tauri and off macOS", async () => {
    watchFullscreen("macos")();
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    watchFullscreen("windows")();
    await flush();
    expect(window$.onResized).toBeNull();
    expect(root.dataset.fullscreen).toBeUndefined();
  });

  it("mirrors native fullscreen on <html data-fullscreen> on macOS", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    const stop = watchFullscreen("macos");
    await flush();
    expect(root.dataset.fullscreen).toBeUndefined();

    window$.fullscreen = true;
    window$.onResized?.();
    await flush();
    expect(root.dataset.fullscreen).toBe("");

    window$.fullscreen = false;
    window$.onResized?.();
    await flush();
    expect(root.dataset.fullscreen).toBeUndefined();

    stop();
    expect(window$.unlisten).toHaveBeenCalled();
  });
});
