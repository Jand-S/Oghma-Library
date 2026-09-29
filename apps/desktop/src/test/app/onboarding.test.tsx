import { screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupCompleteKey } from "../../core/appConfig";
import { discoverStrings } from "../../strings/discover";
import { onboardingStrings } from "../../strings/onboarding";
import { renderApp, resetAppState, setupUser } from "../renderApp";

describe("Onboarding", () => {
  beforeEach(resetAppState);

  it("guides the first opening through the onboarding wizard", async () => {
    const user = setupUser();
    renderApp();

    expect(await screen.findByRole("heading", { name: onboardingStrings.steps[0] }, { timeout: 5000 })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    expect(screen.getByLabelText(onboardingStrings.serverUrlLabel)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.validateServer }));
    expect(await screen.findByText(onboardingStrings.sourcesAvailable(3))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    expect(screen.getByLabelText(onboardingStrings.outputPathLabel)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    expect(screen.getByText(onboardingStrings.sourcesHeading)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    expect(screen.getByText(onboardingStrings.preferencesHeading)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    expect(screen.getByText(onboardingStrings.summaryHeading)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: onboardingStrings.finishAndSync }));
    expect(screen.getByText(onboardingStrings.syncHeading)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: onboardingStrings.enterApp })).toBeEnabled();
    }, { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: onboardingStrings.enterApp }));

    expect(await screen.findByText(discoverStrings.results)).toBeInTheDocument();
    expect(window.localStorage.getItem(setupCompleteKey)).toBe("1");
  }, 15000);
});
