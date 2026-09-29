import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect } from "vitest";
import { App } from "../App";
import { defaultAppConfig, setupCompleteKey, setupStorageKey } from "../core/appConfig";
import type { AppConfig } from "../core/types";
import type { BackendClient } from "../services/backendClient";
import { createDownloadQueue, type DownloadQueue, type RunJob } from "../services/downloadQueue";
import { mockBackendClient, setMockLatencyScale } from "../services/mockBackend";
import { uiStrings } from "../strings/common";
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

/**
 * Job runner that reports some progress and then holds the job until it is aborted
 * (cancel/pause), so tests can inspect the active download.
 */
export const holdingRunner: RunJob = (_job, { signal, onProgress }) =>
  new Promise((_resolve, reject) => {
    onProgress({ stage: "fetching", percent: 42, speedBps: 1_258_291, etaSec: 35 });
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });

/** Runner that commits right away into `<outputRoot>/<title>`. */
export const instantRunner: RunJob = async (job) => ({
  finalDir: `${job.request.outputRoot}/${job.title}`,
  outputFiles: job.request.formats.map((format) => `${job.title}.${format.toLowerCase()}`)
});

/** In-memory queue for app tests (no localStorage, no real downloads). */
export function createTestQueue(options: { runJob?: RunJob; maxQueued?: number } = {}): DownloadQueue {
  return createDownloadQueue({
    runJob: options.runJob ?? holdingRunner,
    persist: false,
    autoStart: false,
    maxQueued: options.maxQueued
  });
}

/** Renders the app without seeding setup (first-run onboarding flow). */
export function renderApp(backend: BackendClient = mockBackendClient, queue: DownloadQueue = createTestQueue()) {
  const result = render(<App backend={backend} downloadQueue={queue} />);
  return { ...result, queue };
}

/** Seeds a completed setup, renders the app and waits for the discover results. */
export async function renderReadyApp(backend: BackendClient = mockBackendClient, queue: DownloadQueue = createTestQueue()) {
  seedSetup();
  const result = renderApp(backend, queue);
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

/** The PageHeader, which hosts each view's toolbar (search, count, actions). */
export function getToolbar() {
  return screen.getByTestId("page-header");
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

/** Returns the toast region (bottom-right notifications). */
export function getToastRegion() {
  return screen.getByRole("region", { name: uiStrings.notifications });
}
