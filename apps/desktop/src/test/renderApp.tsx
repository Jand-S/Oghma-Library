import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";
import { App } from "../App";
import { defaultAppConfig, setupCompleteKey, setupStorageKey } from "../core/appConfig";
import type { AppConfig } from "../core/types";
import type { BackendClient } from "../services/backendClient";
import { mockBackendClient, setMockLatencyScale } from "../services/mockBackend";
import { discoverStrings } from "../strings/discover";

// App tests exercise UI flows, not network timing: resolve mock calls right away.
setMockLatencyScale(0);

export const defaultBookTitle = "The Enchanted Forest";

export function setupUser() {
  return userEvent.setup({ delay: null });
}

export type TestUser = ReturnType<typeof setupUser>;

/** Clears persisted state between tests; use as `beforeEach(resetAppState)`. */
export function resetAppState() {
  window.localStorage.clear();
}

export function seedSetup(config: AppConfig = defaultAppConfig(["central-novel", "novel-mania"])) {
  window.localStorage.setItem(setupStorageKey, JSON.stringify(config));
  window.localStorage.setItem(setupCompleteKey, "1");
}

/** Renders the app without seeding setup (first-run onboarding flow). */
export function renderApp(backend: BackendClient = mockBackendClient) {
  return render(<App backend={backend} />);
}

/** Seeds a completed setup, renders the app and waits for the discover results. */
export async function renderReadyApp(backend: BackendClient = mockBackendClient) {
  seedSetup();
  const result = renderApp(backend);
  await findBookCardTitle(defaultBookTitle);
  return result;
}

/** Returns a regex matching a tab whose accessible name starts with `label` (tabs may append a counter). */
export function tabName(label: string) {
  return new RegExp(`^${label}`, "i");
}

function findCardWithTitle(cards: HTMLElement[], title: string) {
  for (const card of cards) {
    const element = within(card).queryByText(title);
    if (element) return { card, title: element };
  }
  return undefined;
}

/** Finds the title element of a discover result card. */
export async function findBookCardTitle(title: string) {
  return waitFor(() => {
    const match = findCardWithTitle(screen.queryAllByTestId("book-card"), title);
    if (!match) throw new Error(`Book card "${title}" not found`);
    return match.title;
  }, { timeout: 5000 });
}

/** Returns a library card and its title element. */
export function getLibraryCard(title: string) {
  const match = findCardWithTitle(screen.queryAllByTestId("library-card"), title);
  if (!match) throw new Error(`Library card "${title}" not found`);
  return match;
}

export function getQueuePanel() {
  return screen.getByTestId("queue-panel");
}

export function getDetailPanel() {
  return screen.getByTestId("discover-detail-panel");
}

export function getContentArea() {
  return screen.getByTestId("content-area");
}

export function getToolbar() {
  return screen.getByTestId("toolbar");
}

export function getActiveFilterRow() {
  return screen.getByTestId("active-filter-row");
}

export function getFilterPanel() {
  return screen.getByTestId("filter-panel");
}

export function getFirstFilterField() {
  return within(getFilterPanel()).getAllByTestId("filter-field")[0];
}

export async function queueFirstBook(user: TestUser, title = defaultBookTitle) {
  await user.click(await screen.findByRole("button", { name: discoverStrings.selectForQueue(title) }));
  const panel = getQueuePanel();
  await waitFor(() => {
    expect(within(panel).getByText(title)).toBeInTheDocument();
  });
  return panel;
}

export async function inspectBook(user: TestUser, title = defaultBookTitle) {
  const cardTitle = await findBookCardTitle(title);
  await user.click(cardTitle);
  const panel = getDetailPanel();
  await waitFor(() => {
    expect(within(panel).getByText(title)).toBeInTheDocument();
  });
  return panel;
}

export async function expandSelectionCard(user: TestUser, panel: HTMLElement, title = defaultBookTitle) {
  await user.click(within(panel).getByRole("button", { name: discoverStrings.expandSelection(title) }));
  await waitFor(() => {
    expect(within(panel).getByRole("button", { name: discoverStrings.collapseSelection(title) })).toBeInTheDocument();
  });
}
