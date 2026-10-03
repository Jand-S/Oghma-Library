import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStorageKey } from "../../core/appConfig";
import { uiPreferencesKey } from "../../features/settings/preferences";
import { pageTitleStrings } from "../../strings/common";
import { onboardingStrings } from "../../strings/onboarding";
import { settingsStrings } from "../../strings/settings";
import { renderReadyApp, resetAppState, setupUser, type TestUser } from "../renderApp";

function storedConfig() {
  return JSON.parse(window.localStorage.getItem(setupStorageKey) ?? "{}");
}

async function openSettings(user: TestUser, tab?: keyof typeof settingsStrings.categories) {
  await user.click(screen.getByTestId("nav-settings"));
  await screen.findByTestId("settings-page");
  if (tab) await user.click(screen.getByRole("tab", { name: settingsStrings.categories[tab] }));
}

describe("Settings", () => {
  beforeEach(resetAppState);

  it("shows the categories as vertical tabs, navigable with the arrow keys", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user);

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(Object.values(settingsStrings.categories));
    expect(screen.getByRole("tab", { name: settingsStrings.categories.general })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 3, name: settingsStrings.groups.locale.title })).toBeInTheDocument();
    expect(screen.getByLabelText(settingsStrings.theme)).toBeDisabled();

    screen.getByRole("tab", { name: settingsStrings.categories.general }).focus();
    await user.keyboard("{ArrowDown}");
    const downloads = screen.getByRole("tab", { name: settingsStrings.categories.downloads });
    expect(downloads).toHaveAttribute("aria-selected", "true");
    expect(downloads).toHaveFocus();
    expect(screen.getByTestId("settings-section-downloads")).toBeInTheDocument();
  });

  it("validates the output folder inline and saves it on Enter", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "downloads");

    const field = screen.getByLabelText(settingsStrings.outputPath);
    const previous = storedConfig().outputPath;
    await user.clear(field);
    await user.tab();
    expect(await screen.findByText(settingsStrings.outputPathRequired)).toBeInTheDocument();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(storedConfig().outputPath).toBe(previous);

    await user.type(field, "/Users/leitor/Livros{Enter}");
    await waitFor(() => expect(storedConfig().outputPath).toBe("/Users/leitor/Livros"));
    expect(screen.queryByText(settingsStrings.outputPathRequired)).not.toBeInTheDocument();
    expect(await screen.findByText(settingsStrings.saved)).toBeInTheDocument();
  });

  it("toggles default formats but always keeps one", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "downloads");

    const picker = screen.getByTestId("format-picker");
    const epub = within(picker).getByRole("button", { name: "EPUB" });
    expect(epub).toHaveAttribute("aria-pressed", "true");
    await user.click(within(picker).getByRole("button", { name: /AZW3/ }));
    await waitFor(() => expect(storedConfig().defaultFormats).toEqual(["EPUB", "AZW3"]));

    await user.click(within(picker).getByRole("button", { name: /AZW3/ }));
    await user.click(epub);
    expect(epub).toHaveAttribute("aria-pressed", "true");
    expect(storedConfig().defaultFormats).toEqual(["EPUB"]);
  });

  it("stores the start page and chapter preset preferences", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user);
    await user.selectOptions(screen.getByLabelText(settingsStrings.startPage), "library");
    await openSettings(user, "downloads");
    await user.click(screen.getByRole("radio", { name: settingsStrings.chapterPresets.range }));
    expect(JSON.parse(window.localStorage.getItem(uiPreferencesKey) ?? "{}")).toEqual({ startPage: "library", chapterPreset: "range" });
  });

  it("verifies the index server and shows its status", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "server");

    const status = screen.getByTestId("server-status");
    expect(within(status).getByText(settingsStrings.serverUnchecked)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: onboardingStrings.validateServer }));
    expect(await within(status).findByText(/^Online · \d+ ms$/)).toBeInTheDocument();

    // Editing the URL invalidates the check; an invalid URL is rejected inline.
    const url = screen.getByLabelText(settingsStrings.serverUrl);
    await user.clear(url);
    await user.type(url, "servidor-sem-protocolo{Enter}");
    expect(await screen.findByText(settingsStrings.serverUrlInvalid)).toBeInTheDocument();
    expect(storedConfig().serverUrl).not.toBe("servidor-sem-protocolo");
  });

  it("syncs the enabled sources and records the time", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "server");

    const lastSync = screen.getByTestId("last-sync");
    expect(within(lastSync).getByText(settingsStrings.lastSyncNever)).toBeInTheDocument();
    await user.click(within(lastSync).getByRole("button", { name: settingsStrings.syncNow }));
    expect(await within(lastSync).findByText(/^Hoje, \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("links to Tradução from the audio category", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "audio");
    // The audiobook settings were removed (there is no audiobook generator).
    expect(screen.queryByLabelText(settingsStrings.ttsVoice)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: settingsStrings.openTranslation }));
    expect(await screen.findByRole("heading", { level: 1, name: pageTitleStrings.translation })).toBeInTheDocument();
  });

  it("re-opens the onboarding from Sobre after confirming", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openSettings(user, "about");

    expect(screen.getByTestId("app-version")).toHaveTextContent(/^Versão \d+\.\d+\.\d+/);
    await user.click(screen.getByRole("button", { name: settingsStrings.rerunSetup }));
    const confirm = await screen.findByRole("dialog", { name: settingsStrings.rerunSetupConfirmTitle });
    await user.click(within(confirm).getByRole("button", { name: settingsStrings.rerunSetupConfirm }));

    expect(await screen.findByRole("heading", { name: onboardingStrings.welcomeTitle })).toBeInTheDocument();
    // A completed setup can close the wizard again.
    await user.click(screen.getByRole("button", { name: onboardingStrings.close }));
    await waitFor(() => expect(screen.queryByTestId("onboarding")).not.toBeInTheDocument());
  });
});
