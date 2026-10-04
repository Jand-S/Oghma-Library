import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupCompleteKey } from "../../core/appConfig";
import { discoverStrings } from "../../strings/discover";
import { onboardingStrings } from "../../strings/onboarding";
import { renderApp, resetAppState, setupUser } from "../renderApp";

async function openWizard() {
  const dialog = await screen.findByRole("dialog", {}, { timeout: 5000 });
  await screen.findByRole("heading", { name: onboardingStrings.welcomeTitle });
  return dialog;
}

describe("Onboarding", () => {
  beforeEach(resetAppState);

  it("guides the first opening through the five onboarding steps", async () => {
    const user = setupUser();
    renderApp();
    await openWizard();
    expect(screen.getByTestId("onboarding-step")).toHaveTextContent(onboardingStrings.stepOf(1, 6));

    // 1. Boas-vindas
    await user.click(screen.getByRole("button", { name: onboardingStrings.start }));

    // 2. Conta (optional; outside the desktop app it only explains where to sign in later).
    expect(screen.getByRole("heading", { name: onboardingStrings.accountTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: onboardingStrings.accountSkip }));

    // 2. Servidor: "Próximo" stays disabled until the server is verified.
    expect(screen.getByLabelText(onboardingStrings.serverUrlLabel)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: onboardingStrings.next })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: onboardingStrings.validateServer }));
    expect(await screen.findByText(onboardingStrings.sourcesAvailable(3))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));

    // 3. Pasta da biblioteca
    expect(screen.getByLabelText(onboardingStrings.outputPathLabel)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));

    // 4. Preferências: formats and the sources to index (the old "Fontes" step).
    expect(screen.getByRole("heading", { name: onboardingStrings.preferencesHeading })).toBeInTheDocument();
    expect(screen.getByText(onboardingStrings.sourcesHeading)).toBeInTheDocument();
    expect(screen.getByTestId("format-picker")).toBeInTheDocument();

    // 5. Sincronização, with the old "Resumo" merged in.
    await user.click(screen.getByRole("button", { name: onboardingStrings.finishAndSync }));
    expect(screen.getByRole("heading", { name: onboardingStrings.syncHeading })).toBeInTheDocument();
    expect(screen.getByText(onboardingStrings.summaryHeading)).toBeInTheDocument();
    expect(screen.getByTestId("onboarding-step")).toHaveTextContent(onboardingStrings.stepOf(6, 6));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: onboardingStrings.enterApp })).toBeEnabled();
    }, { timeout: 8000 });
    await user.click(screen.getByRole("button", { name: onboardingStrings.enterApp }));

    // A new user lands on Início (the default start page).
    expect(await screen.findByTestId("home-page")).toBeInTheDocument();
    expect(window.localStorage.getItem(setupCompleteKey)).toBe("1");
  }, 15000);

  it("requires at least one source before syncing", async () => {
    const user = setupUser();
    renderApp();
    await openWizard();
    await user.click(screen.getByRole("button", { name: onboardingStrings.start }));
    await user.click(screen.getByRole("button", { name: onboardingStrings.accountSkip }));
    await user.click(screen.getByRole("button", { name: onboardingStrings.validateServer }));
    await screen.findByText(onboardingStrings.sourcesAvailable(3));
    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));
    await user.click(screen.getByRole("button", { name: onboardingStrings.next }));

    const sources = screen.getByRole("group", { name: onboardingStrings.sourcesHeading });
    for (const toggle of within(sources).getAllByRole("switch")) {
      if (toggle.getAttribute("aria-checked") === "true") await user.click(toggle);
    }
    expect(screen.getByText(onboardingStrings.sourcesRequired)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: onboardingStrings.finishAndSync })).toBeDisabled();
  });

  it("advances with Enter, goes back with Esc and ignores Esc on the first step", async () => {
    renderApp();
    const dialog = await openWizard();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("heading", { name: onboardingStrings.welcomeTitle })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("heading", { name: onboardingStrings.welcomeTitle }), { key: "Enter" });
    // The optional account step: Enter skips it.
    fireEvent.keyDown(await screen.findByRole("heading", { name: onboardingStrings.accountTitle }), { key: "Enter" });
    const url = await screen.findByLabelText(onboardingStrings.serverUrlLabel);

    // Enter inside the URL field verifies the server instead of advancing.
    fireEvent.keyDown(url, { key: "Enter" });
    expect(await screen.findByText(onboardingStrings.sourcesAvailable(3))).toBeInTheDocument();
    fireEvent.keyDown(url, { key: "Enter" });
    expect(await screen.findByLabelText(onboardingStrings.outputPathLabel)).toBeInTheDocument();

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(await screen.findByLabelText(onboardingStrings.serverUrlLabel)).toBeInTheDocument();
  });
});
