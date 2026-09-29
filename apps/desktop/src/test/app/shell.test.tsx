import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { windowControlStrings } from "../../strings/common";
import { renderApp, resetAppState, seedSetup, setupUser } from "../renderApp";

describe("App shell", () => {
  beforeEach(resetAppState);

  it("dispatches window control actions outside the Tauri runtime", async () => {
    const user = setupUser();
    const listener = vi.fn();
    window.addEventListener("oghma-window-action", listener);
    seedSetup();
    renderApp();

    await user.click(screen.getByLabelText(windowControlStrings.minimize));
    await user.click(screen.getByLabelText(windowControlStrings.maximize));
    await user.click(screen.getByLabelText(windowControlStrings.close));

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual(["minimize", "maximize", "close"]);
    window.removeEventListener("oghma-window-action", listener);
  });
});
