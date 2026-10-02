import { act, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../App";
import { LimitBanner } from "../../features/translation/AccountStrip";
import type {
  ChapterView,
  GlossaryEntry,
  PilotRun,
  ProjectDetail,
  TranslationAccount,
  TranslationClient,
  TranslationEventName,
  TranslationEvents,
  UsageSnapshot,
  VerifyReport
} from "../../services/translationClient";
import { navStrings } from "../../strings/common";
import { translationStrings as t } from "../../strings/translation";
import { createTestQueue, findBookCardTitle, getToastRegion, resetAppState, seedSetup, setupUser, type TestUser } from "../renderApp";
import { mockBackendClient } from "../../services/mockBackend";

/* ---------- Fake engine (scripted `translation_*` commands + event emitter) ---------- */

const NOW = () => Math.floor(Date.now() / 1000);

function makeDetail(overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "p1",
    title: "To Kill a Mockingbird",
    sourceNovelId: "enchanter-forest",
    status: "ready",
    chaptersTotal: 31,
    chaptersDone: 0,
    chunksTotal: 10,
    chunksDone: 0,
    percent: 0,
    model: "gpt-6-luna",
    effort: "none",
    workers: 2,
    scope: { kind: "all" },
    wordsTotal: 90_000,
    wordsDone: 0,
    needsReview: 0,
    errors: 0,
    pending: 10,
    chaptersInProgress: [],
    chunksPerMinute: null,
    etaSeconds: null,
    resumeAt: null,
    glossaryStatus: "ready",
    ...overrides
  };
}

function makeUsage(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
  return {
    local: { words5h: 3200, credits5h: 4.5, words7d: 18_000, credits7d: 25 },
    limitReached: null,
    settingsUrl: "https://chatgpt.com/settings/usage",
    ...overrides
  };
}

type EngineState = {
  account: TranslationAccount;
  usage: UsageSnapshot;
  projects: ProjectDetail[];
  glossary: GlossaryEntry[];
  pilot: PilotRun | null;
  report: VerifyReport;
  chapters: Record<number, ChapterView>;
};

type Handler = (args: Record<string, unknown>) => unknown;

function createEngine(initial: Partial<EngineState> = {}, overrides: Record<string, Handler> = {}) {
  const state: EngineState = {
    account: { loggedIn: true, email: "leitor@example.com", planType: "plus" },
    usage: makeUsage(),
    projects: [],
    glossary: [],
    pilot: null,
    report: { ok: true, chapters: [] },
    chapters: {},
    ...initial
  };
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const find = (args: Record<string, unknown>) => {
    const project = state.projects.find((item) => item.id === args.projectId);
    if (!project) throw new Error(`unknown project ${String(args.projectId)}`);
    return project;
  };
  const replace = (next: ProjectDetail) => {
    state.projects = state.projects.map((item) => (item.id === next.id ? next : item));
    return next;
  };

  const handlers: Record<string, Handler> = {
    translation_account: () => state.account,
    translation_login: () => undefined,
    translation_login_cancel: () => undefined,
    translation_logout: () => {
      state.account = { loggedIn: false };
    },
    translation_usage: () => state.usage,
    translation_list_projects: () => state.projects,
    translation_create_project: (args) => {
      const created = makeDetail({ id: "p-new", title: String(args.title), sourceNovelId: args.sourceNovelId as string, status: "preparing", glossaryStatus: "running" });
      state.projects = [created, ...state.projects];
      return created;
    },
    translation_get_project: (args) => find(args),
    translation_update_settings: (args) => {
      const { projectId: _id, ...patch } = args;
      return replace({ ...find(args), ...(patch as Partial<ProjectDetail>) });
    },
    translation_start: () => undefined,
    translation_pause: () => undefined,
    translation_cancel: () => undefined,
    translation_export: (args) => ({ outputDir: "/books/x (PT-BR)", title: `${find(args).title} (PT-BR)` }),
    translation_log: () => [],
    translation_pilot: () => state.pilot,
    translation_run_pilot: () => undefined,
    translation_choose_model: (args) => replace({ ...find(args), model: String(args.model) }),
    translation_glossary: () => state.glossary,
    translation_glossary_upsert: (args) => {
      const entry = args.entry as { term: string; kind: GlossaryEntry["kind"]; target?: string };
      const existing = state.glossary.find((item) => item.term === entry.term);
      const next: GlossaryEntry = { term: entry.term, kind: entry.kind, target: entry.target ?? null, count: existing?.count ?? 0, source: "manual", missed: 0 };
      state.glossary = existing ? state.glossary.map((item) => (item.term === entry.term ? next : item)) : [...state.glossary, next];
      return state.glossary;
    },
    translation_glossary_delete: (args) => {
      state.glossary = state.glossary.filter((item) => item.term !== args.term);
      return state.glossary;
    },
    translation_glossary_regenerate: () => undefined,
    translation_glossary_suggest: (args) =>
      (args.terms as string[]).map((term) =>
        term === "Crimson Moon"
          ? { term, kind: "translate", target: "Lua Carmesim", reason: "Nome de lugar traduzível." }
          : { term, kind: "keep", target: null, reason: "Nome próprio." }
      ),
    translation_verify: () => state.report,
    translation_chapter: (args) => {
      const chapter = state.chapters[args.chapterIndex as number];
      if (!chapter) throw new Error("no chapter");
      return chapter;
    },
    translation_retranslate: () => undefined,
    translation_retranslate_chunk: () => undefined,
    translation_mark_reviewed: (args) => {
      const chapter = state.chapters[args.chapterIndex as number];
      const chunks = chapter.chunks.map((c) => (c.index === args.chunkIndex ? { ...c, reviewed: true, issues: [], status: "done" } : c));
      state.chapters[args.chapterIndex as number] = { ...chapter, chunks };
      return state.chapters[args.chapterIndex as number];
    },
    ...overrides
  };

  const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected command ${command}`);
    return handler(args ?? {});
  });
  const openUrl = vi.fn(async () => undefined);

  const client: TranslationClient = {
    available: true,
    invoke: invoke as TranslationClient["invoke"],
    async listen(event, handler) {
      const set = listeners.get(event) ?? new Set();
      listeners.set(event, set);
      const wrapped = handler as (payload: unknown) => void;
      set.add(wrapped);
      return () => set.delete(wrapped);
    },
    openUrl
  };

  const emit = <E extends TranslationEventName>(event: E, payload: TranslationEvents[E]) => {
    act(() => {
      for (const handler of listeners.get(event) ?? []) handler(payload);
    });
  };

  /** Args of every call to `command`. */
  const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command).map(([, args]) => args);

  return { state, client, emit, invoke, openUrl, calls };
}

type Engine = ReturnType<typeof createEngine>;

async function renderWithEngine(client?: TranslationClient) {
  seedSetup();
  const result = render(<App backend={mockBackendClient} downloadQueue={createTestQueue()} translationClient={client} />);
  await findBookCardTitle("The Enchanted Forest");
  return result;
}

async function openTranslation(user: TestUser) {
  await user.click(screen.getByRole("button", { name: navStrings.translation }));
}

async function openProject(user: TestUser, engine: Engine) {
  await renderWithEngine(engine.client);
  await openTranslation(user);
  return screen.findByTestId("translation-workspace");
}

function workspaceTab(name: string) {
  return within(screen.getByRole("radiogroup", { name: t.workspaceTabs })).getByRole("radio", { name });
}

/* ---------- Tests ---------- */

describe("Translation", () => {
  beforeEach(resetAppState);

  describe("account", () => {
    it("is unavailable outside the desktop app", async () => {
      const user = setupUser();
      await renderWithEngine();
      await openTranslation(user);

      expect(await screen.findByText(t.unavailableTitle)).toBeInTheDocument();
      expect(screen.queryByTestId("translation-page")).not.toBeInTheDocument();
    });

    it("connects a logged-out account through the browser flow", async () => {
      const user = setupUser();
      const engine = createEngine({ account: { loggedIn: false } });
      await renderWithEngine(engine.client);
      await openTranslation(user);

      const strip = await screen.findByTestId("translation-account");
      expect(strip).toHaveTextContent(t.accountDisconnected);
      expect(screen.queryByTestId("translation-local-usage")).not.toBeInTheDocument();

      await user.click(within(strip).getByRole("button", { name: t.connect }));
      expect(engine.calls("translation_login")).toHaveLength(1);
      expect(await screen.findByTestId("translation-connecting")).toHaveTextContent(t.connectWaiting);

      // Rust finishes the PKCE flow and announces the account.
      engine.state.account = { loggedIn: true, email: "novo@example.com", planType: "plus" };
      engine.emit("translation://account", { loggedIn: true, email: "novo@example.com", planType: "plus" });

      expect(await within(strip).findByText(t.usingPlan)).toBeInTheDocument();
      expect(within(strip).getByTestId("translation-account-email")).toHaveTextContent("novo@example.com");
      expect(within(getToastRegion()).getByText(t.connectedToast("novo@example.com"))).toBeInTheDocument();
    });

    it("cancels a pending login", async () => {
      const user = setupUser();
      const engine = createEngine({ account: { loggedIn: false } });
      await renderWithEngine(engine.client);
      await openTranslation(user);

      const strip = await screen.findByTestId("translation-account");
      await user.click(within(strip).getByRole("button", { name: t.connect }));
      await user.click(await within(strip).findByRole("button", { name: t.connectCancel }));

      expect(engine.calls("translation_login_cancel")).toHaveLength(1);
      expect(within(strip).getByRole("button", { name: t.connect })).toBeInTheDocument();
    });

    it("shows the plan card, the local counters, Gerenciar uso and Sair when logged in", async () => {
      const user = setupUser();
      const engine = createEngine();
      await renderWithEngine(engine.client);
      await openTranslation(user);

      const strip = await screen.findByTestId("translation-account");
      expect(within(strip).getByText(t.usingPlan)).toBeInTheDocument();
      expect(within(strip).getByTestId("translation-account-email")).toHaveTextContent("leitor@example.com");
      const local = await within(strip).findByTestId("translation-local-usage");
      expect(local).toHaveTextContent("Traduzido nas últimas 5h: 3,2 mil palavras (~4,5 créditos)");
      // No usage % anywhere: there is no API for it.
      expect(strip.textContent).not.toMatch(/%/);
      expect(screen.queryByTestId("translation-limit")).not.toBeInTheDocument();

      await user.click(within(strip).getByRole("button", { name: t.manageUsage }));
      expect(engine.openUrl).toHaveBeenCalledWith("https://chatgpt.com/settings/usage");

      await user.click(within(strip).getByRole("button", { name: t.logout }));
      expect(engine.calls("translation_logout")).toHaveLength(1);
      expect(await within(strip).findByText(t.accountDisconnected)).toBeInTheDocument();
      expect(within(strip).getByRole("button", { name: t.connect })).toBeInTheDocument();
    });

    it("shows the limit banner when the usage snapshot reports a limit", async () => {
      const user = setupUser();
      const engine = createEngine();
      await renderWithEngine(engine.client);
      await openTranslation(user);
      await screen.findByTestId("translation-local-usage");
      expect(screen.queryByTestId("translation-limit")).not.toBeInTheDocument();

      engine.emit("translation://usage", makeUsage({ limitReached: { at: NOW(), window: "weekly", nextRetryAt: NOW() + 12 * 60 + 30 } }));

      const banner = await screen.findByTestId("translation-limit");
      expect(banner).toHaveTextContent(/^Limite do ChatGPT atingido \(semanal\)\. Tentando de novo em 12min \d\ds\.$/);
      expect(banner).toHaveAttribute("title", t.limitTooltip);

      engine.emit("translation://usage", makeUsage());
      await waitFor(() => expect(screen.queryByTestId("translation-limit")).not.toBeInTheDocument());
    });
  });

  describe("limit banner countdown", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("ticks down every second and switches to 'agora' when the retry is due", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
      const now = Math.floor(Date.now() / 1000);
      render(<LimitBanner limit={{ at: now, window: "five_hour", nextRetryAt: now + 12 * 60 + 5 }} />);

      const text = () => screen.getByTestId("translation-limit-text").textContent;
      expect(text()).toBe("Limite do ChatGPT atingido (janela de 5h). Tentando de novo em 12min 05s.");

      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(text()).toBe("Limite do ChatGPT atingido (janela de 5h). Tentando de novo em 12min 04s.");

      act(() => {
        vi.advanceTimersByTime((12 * 60 + 4) * 1000);
      });
      expect(text()).toBe(t.limitBannerSoon("janela de 5h"));
    });

    it("omits the window when it is unknown", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-10-02T12:00:00Z"));
      const now = Math.floor(Date.now() / 1000);
      render(<LimitBanner limit={{ at: now, window: "unknown", nextRetryAt: now + 45 }} />);
      expect(screen.getByTestId("translation-limit-text")).toHaveTextContent("Limite do ChatGPT atingido. Tentando de novo em 45s.");
    });
  });

  it("creates a project from a library book with the default settings", async () => {
    const user = setupUser();
    const engine = createEngine();
    await renderWithEngine(engine.client);
    await openTranslation(user);

    expect(await screen.findByText(t.emptyProjectsTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: t.translateBook }));

    const dialog = await screen.findByRole("dialog", { name: t.pickerTitle });
    const create = within(dialog).getByRole("button", { name: t.pickerCreate });
    expect(create).toBeDisabled();
    const book = within(dialog).getAllByTestId("translation-picker-book").find((item) => item.textContent?.includes("To Kill a Mockingbird"));
    expect(book).toBeDefined();
    await user.click(book!);
    expect(book).toHaveAttribute("aria-pressed", "true");
    await user.click(create);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: t.pickerTitle })).not.toBeInTheDocument());
    expect(engine.calls("translation_create_project")).toEqual([
      { sourceDir: "~/Documents/Oghma Library/exports/To Kill a Mockingbird", sourceNovelId: "enchanter-forest", title: "To Kill a Mockingbird" }
    ]);
    expect(engine.calls("translation_update_settings")).toEqual([{ projectId: "p-new", model: "gpt-6-luna", effort: "none", workers: 2 }]);

    const workspace = await screen.findByTestId("translation-workspace");
    expect(within(workspace).getByRole("heading", { name: "To Kill a Mockingbird" })).toBeInTheDocument();
    // New projects open on the pilot.
    expect(workspaceTab(t.tabPilot)).toHaveAttribute("aria-checked", "true");
    expect(screen.getAllByTestId("translation-project")).toHaveLength(1);
    expect(within(getToastRegion()).getByText(t.projectCreated("To Kill a Mockingbird"))).toBeInTheDocument();
  });

  it("builds a preview before the end", async () => {
    const user = setupUser();
    const engine = createEngine({ projects: [makeDetail({ status: "paused", chaptersDone: 4, chaptersTotal: 31 })] });
    await openProject(user, engine);

    const book = await screen.findByTestId("translation-book");
    expect(book).toHaveTextContent(t.previewHint(4, 31));
    await user.click(within(book).getByRole("button", { name: t.previewNow }));
    expect(engine.calls("translation_export")).toEqual([{ projectId: "p1", partial: true }]);

    engine.emit("translation://exported", { projectId: "p1", outputDir: "/books/x (PT-BR)", title: "To Kill a Mockingbird (PT-BR)", preview: true });
    expect(await within(getToastRegion()).findByText(t.previewToast("To Kill a Mockingbird (PT-BR)"))).toBeInTheDocument();
  });

  it("updates the progress dashboard from translation://project events", async () => {
    const user = setupUser();
    const engine = createEngine({ projects: [makeDetail()] });
    await openProject(user, engine);

    const progress = await screen.findByTestId("translation-progress");
    expect(progress).toHaveAttribute("data-status", "ready");
    expect(within(progress).getByTestId("translation-percent")).toHaveTextContent("0,0%");
    await user.click(within(progress).getByRole("button", { name: t.start }));
    expect(engine.calls("translation_start")).toEqual([{ projectId: "p1" }]);

    engine.emit("translation://project", makeDetail({
      status: "running",
      chunksDone: 5,
      chaptersDone: 12,
      wordsDone: 45_000,
      percent: 50,
      pending: 5,
      chaptersInProgress: ["Capítulo 13"],
      chunksPerMinute: 2.5,
      etaSeconds: 120
    }));

    await waitFor(() => expect(screen.getByTestId("translation-progress")).toHaveAttribute("data-status", "running"));
    expect(screen.getByTestId("translation-percent")).toHaveTextContent("50,0%");
    expect(screen.getByTestId("card-chapters")).toHaveTextContent("12");
    expect(screen.getByTestId("card-eta")).toHaveTextContent("2min");
    expect(screen.getByTestId("card-eta")).toHaveTextContent("2,5 trechos/min");
    expect(screen.getByTestId("card-credits")).toHaveTextContent("~4,5");
    expect(screen.getByText("Capítulo 13")).toBeInTheDocument();
    expect(screen.getByTestId("translation-status")).toHaveTextContent(t.status.running);
    expect(screen.getAllByTestId("translation-project")[0]).toHaveTextContent("50%");
    expect(screen.getByRole("button", { name: t.pause })).toBeInTheDocument();

    engine.emit("translation://log", { projectId: "p1", event: { at: NOW(), level: "warn", message: "Termo 'Mana' não aplicado" } });
    expect(await screen.findByText("Termo 'Mana' não aplicado")).toBeInTheDocument();

    // ChatGPT refuses for limits: the progress tab shows its own waiting banner with the countdown.
    engine.emit("translation://usage", makeUsage({ limitReached: { at: NOW(), window: "five_hour", nextRetryAt: NOW() + 600 } }));
    engine.emit("translation://project", makeDetail({ status: "waiting_limit", chunksDone: 5, percent: 50, resumeAt: NOW() + 600 }));
    const banner = await screen.findByTestId("translation-banner");
    expect(banner).toHaveAttribute("data-kind", "waiting");
    expect(within(banner).getByTestId("translation-waiting-detail")).toHaveTextContent(/janela de 5h\)\. Tentando de novo em (10min 00s|9min \d\ds)\./);
    // The global banner is not duplicated over the progress tab.
    expect(screen.queryByTestId("translation-limit")).not.toBeInTheDocument();

    engine.emit("translation://project", makeDetail({ status: "done", chunksDone: 10, chaptersDone: 31, percent: 100, pending: 0 }));
    await user.click(await screen.findByRole("button", { name: t.exportBook }));
    expect(engine.calls("translation_export")).toEqual([{ projectId: "p1", partial: false }]);

    engine.emit("translation://exported", { projectId: "p1", outputDir: "/books/x (PT-BR)", title: "To Kill a Mockingbird (PT-BR)" });
    expect(await within(getToastRegion()).findByText(t.exportedToast("To Kill a Mockingbird (PT-BR)"))).toBeInTheDocument();
  });

  it("runs the pilot, reads each model's text and uses the chosen model", async () => {
    const user = setupUser();
    const engine = createEngine({ projects: [makeDetail()] });
    await openProject(user, engine);

    await user.click(workspaceTab(t.tabPilot));
    const pilot = await screen.findByTestId("translation-pilot");
    expect(within(pilot).getByText(t.pilotEmptyTitle)).toBeInTheDocument();

    await user.click(within(pilot).getByRole("button", { name: t.runPilot }));
    expect(engine.calls("translation_run_pilot")).toEqual([{ projectId: "p1" }]);
    expect(await within(pilot).findByText(t.pilotRunning)).toBeInTheDocument();

    engine.emit("translation://pilot", {
      projectId: "p1",
      run: {
        createdAt: NOW(),
        sourceHtml: "<p>The forest was quiet.</p>",
        words: 1500,
        status: "done",
        samples: [
          { model: "gpt-6-luna", label: "Rápido", seconds: 26.4, inputTokens: 1040, outputTokens: 1350, projectedBookCredits: 62, valid: true, html: "<p>A floresta estava quieta.</p>" },
          { model: "gpt-6-sol", label: "Qualidade", seconds: 31, inputTokens: 1040, outputTokens: 1400, projectedBookCredits: 1250, valid: false, html: "<p>A floresta silenciava.</p>" }
        ]
      }
    });

    const table = await screen.findByTestId("pilot-table");
    expect(within(table).getAllByTestId("pilot-row")).toHaveLength(2);
    expect(table).toHaveTextContent("62 créditos");
    expect(table).toHaveTextContent("1.250 créditos");
    expect(table).toHaveTextContent(t.validBad);
    expect(table.textContent).not.toMatch(/%/);
    expect(screen.queryByText(t.pilotRunning)).not.toBeInTheDocument();

    const readerTabs = screen.getByRole("radiogroup", { name: t.readerTabs });
    expect(screen.getByTestId("pilot-reader")).toHaveTextContent("The forest was quiet.");
    await user.click(within(readerTabs).getByRole("radio", { name: "Rápido" }));
    expect(screen.getByTestId("pilot-reader")).toHaveTextContent("A floresta estava quieta.");
    expect(screen.getByTestId("pilot-in-use")).toBeInTheDocument();

    await user.click(within(readerTabs).getByRole("radio", { name: "Qualidade" }));
    expect(screen.getByTestId("pilot-reader")).toHaveTextContent("A floresta silenciava.");
    await user.click(screen.getByRole("button", { name: t.useModel("Qualidade") }));

    expect(engine.calls("translation_choose_model")).toEqual([{ projectId: "p1", model: "gpt-6-sol" }]);
    expect(await screen.findByTestId("pilot-in-use")).toBeInTheDocument();
    expect(within(getToastRegion()).getByText(t.modelChosen("Qualidade"))).toBeInTheDocument();
    expect(screen.getByText(/Qualidade · 2 traduções simultâneas/)).toBeInTheDocument();
  });

  it("adds, edits and removes glossary terms", async () => {
    const user = setupUser();
    const engine = createEngine({
      projects: [makeDetail()],
      glossary: [
        { term: "Mana", kind: "keep", target: null, count: 40, source: "auto", missed: 0 },
        { term: "Sect", kind: "translate", target: "Seita", count: 12, source: "auto", missed: 2 }
      ]
    });
    await openProject(user, engine);
    await user.click(workspaceTab(t.tabGlossary));

    const glossary = await screen.findByTestId("translation-glossary");
    const rows = await within(glossary).findAllByTestId("glossary-row");
    expect(rows.map((row) => row.getAttribute("data-term"))).toEqual(["Mana", "Sect"]);
    expect(within(glossary).getByText(t.missedSummary(1))).toBeInTheDocument();

    // Add
    await user.click(within(glossary).getByRole("button", { name: t.addTerm }));
    let editor = within(glossary).getByTestId("glossary-edit-row");
    await user.click(within(editor).getByRole("button", { name: t.saveTerm }));
    expect(within(editor).getByText(t.termRequired)).toBeInTheDocument();
    await user.type(within(editor).getByRole("textbox", { name: t.termField }), "Dantian");
    await user.type(within(editor).getByRole("textbox", { name: t.targetField }), "Dantian (centro)");
    await user.click(within(editor).getByRole("button", { name: t.saveTerm }));

    expect(engine.calls("translation_glossary_upsert")).toEqual([{ projectId: "p1", entry: { term: "Dantian", kind: "translate", target: "Dantian (centro)" } }]);
    await waitFor(() => expect(within(glossary).queryByTestId("glossary-edit-row")).not.toBeInTheDocument());
    const added = within(glossary).getAllByTestId("glossary-row").find((row) => row.getAttribute("data-term") === "Dantian")!;
    expect(added).toHaveTextContent("Dantian (centro)");
    expect(added).toHaveTextContent(t.sourceManual);

    // Edit: "Sect" becomes a kept name.
    await user.click(within(glossary).getByRole("button", { name: t.editTerm("Sect") }));
    editor = within(glossary).getByTestId("glossary-edit-row");
    await user.selectOptions(within(editor).getByRole("combobox", { name: t.kindField }), "keep");
    await user.click(within(editor).getByRole("button", { name: t.saveTerm }));
    expect(engine.calls("translation_glossary_upsert")[1]).toEqual({ projectId: "p1", entry: { term: "Sect", kind: "keep", target: undefined } });
    await waitFor(() => expect(within(glossary).queryByTestId("glossary-edit-row")).not.toBeInTheDocument());
    const sect = within(glossary).getAllByTestId("glossary-row").find((row) => row.getAttribute("data-term") === "Sect")!;
    expect(sect).toHaveTextContent(t.kindKeep);

    // Remove
    await user.click(within(glossary).getByRole("button", { name: t.removeTerm("Mana") }));
    expect(engine.calls("translation_glossary_delete")).toEqual([{ projectId: "p1", term: "Mana" }]);
    await waitFor(() => {
      expect(within(glossary).getAllByTestId("glossary-row").map((row) => row.getAttribute("data-term"))).not.toContain("Mana");
    });
  });

  it("suggests translations for glossary terms, one by one or in batch", async () => {
    const user = setupUser();
    const engine = createEngine({
      projects: [makeDetail()],
      glossary: [
        { term: "Lin Feng", kind: "keep", target: null, count: 80, source: "auto", missed: 0 },
        { term: "Crimson Moon", kind: "keep", target: null, count: 9, source: "auto", missed: 0 },
        { term: "time loop", kind: "translate", target: "loop temporal", count: 5, source: "auto", missed: 0 }
      ]
    });
    await openProject(user, engine);
    await user.click(workspaceTab(t.tabGlossary));
    const glossary = await screen.findByTestId("translation-glossary");
    await waitFor(() => expect(within(glossary).getAllByTestId("glossary-row")).toHaveLength(3));

    // Per-term suggestion: accept.
    await user.click(within(glossary).getByRole("button", { name: t.suggest("Crimson Moon") }));
    expect(engine.calls("translation_glossary_suggest").at(-1)).toEqual({ projectId: "p1", terms: ["Crimson Moon"] });
    const suggestion = await within(glossary).findByTestId("glossary-suggestion");
    expect(suggestion).toHaveTextContent(t.suggestionTranslate("Lua Carmesim"));
    expect(suggestion).toHaveTextContent("Nome de lugar traduzível.");
    await user.click(within(suggestion).getByRole("button", { name: t.acceptSuggestion }));
    expect(engine.calls("translation_glossary_upsert").at(-1)).toEqual({ projectId: "p1", entry: { term: "Crimson Moon", kind: "translate", target: "Lua Carmesim" } });
    await waitFor(() => expect(within(glossary).queryByTestId("glossary-suggestion")).not.toBeInTheDocument());
    expect(within(getToastRegion()).getByText(t.termSaved("Crimson Moon"))).toBeInTheDocument();

    // Batch suggestion for the automatic terms still kept untranslated, then dismiss.
    await user.click(within(glossary).getByRole("button", { name: t.suggestAll(1) }));
    expect(engine.calls("translation_glossary_suggest").at(-1)).toEqual({ projectId: "p1", terms: ["Lin Feng"] });
    const keep = await within(glossary).findByTestId("glossary-suggestion");
    expect(keep).toHaveTextContent(t.suggestionKeep);
    await user.click(within(keep).getByRole("button", { name: t.dismissSuggestion }));
    expect(within(glossary).queryByTestId("glossary-suggestion")).not.toBeInTheDocument();
  });

  it("reviews problems paragraph by paragraph, chunk by chunk", async () => {
    const user = setupUser();
    const pair = (source: string, translated: string | null) => ({ source, translated });
    const engine = createEngine({
      projects: [makeDetail({ status: "done", chunksDone: 10, percent: 100 })],
      report: {
        ok: false,
        chapters: [
          { index: 2, title: "Capítulo 2", issues: ["tooShort: trecho 2 (62% das palavras)", "englishLeft: trecho 2 (9,0%)"] },
          { index: 3, title: "Capítulo 3", issues: ["needsReview: trecho 1"] }
        ]
      },
      chapters: {
        1: { index: 1, title: "Capítulo 1", sourceHtml: "", translatedHtml: "", status: "done", issues: [], chunks: [
          { index: 0, status: "done", reviewed: false, issues: [], englishWords: [], pairs: [pair("<p>One.</p>", "<p>Um.</p>")] }
        ] },
        2: { index: 2, title: "Capítulo 2", sourceHtml: "", translatedHtml: "", status: "done", issues: [], chunks: [
          { index: 0, status: "done", reviewed: false, issues: [], englishWords: [], pairs: [pair("<p>Two <script>alert(1)</script>words.</p>", "<p>Duas palavras.</p>")] },
          { index: 1, status: "done", reviewed: false, issues: ["tooShort: 62% das palavras", "englishLeft: 9,0%"], englishWords: ["the"], pairs: [pair("<p>He saw the sea.</p>", "<p>Ele viu the mar.</p>"), pair("<p>Then he left.</p>", null)] }
        ] },
        3: { index: 3, title: "Capítulo 3", sourceHtml: "", translatedHtml: "", status: "needs_review", issues: [], chunks: [
          { index: 0, status: "needs_review", reviewed: false, issues: ["needsReview"], englishWords: [], pairs: [pair("<p>Three.</p>", "<p>Três.</p>")] }
        ] }
      }
    });
    await openProject(user, engine);
    await user.click(workspaceTab(t.tabReview));

    const review = await screen.findByTestId("translation-review");
    expect(await within(review).findByTestId("review-summary")).toHaveTextContent(t.reviewIssues(2));
    expect(engine.calls("translation_verify")).toEqual([{ projectId: "p1" }]);

    // Opens on the first problem: chapter 2, chunk 2, with an explanation and per-chunk actions.
    await waitFor(() => expect(within(review).getByTestId("review-nav")).toHaveTextContent(t.problemNav(1, 2)));
    const alert = await within(review).findByTestId("review-chunk-alert");
    expect(alert).toHaveTextContent(t.chunkLabel(2, 2));
    expect(alert).toHaveTextContent(t.issueHelp.tooShort);
    expect(alert).toHaveTextContent(t.englishMarked);
    const reader = within(review).getByTestId("review-reader");
    expect(reader.querySelector("script")).toBeNull();
    expect(reader).toHaveTextContent("Two words.");
    const marked = [...reader.querySelectorAll("mark.translation-review__en")].map((m) => m.textContent);
    expect(marked).toEqual(["the"]);
    expect(reader).toHaveTextContent(t.paragraphMissing);

    await user.click(within(alert).getByRole("button", { name: t.retranslateChunk }));
    expect(engine.calls("translation_retranslate_chunk")).toEqual([{ projectId: "p1", chapterIndex: 2, chunkIndex: 1 }]);
    expect(await within(getToastRegion()).findByText(t.chunkRetranslateStarted(2))).toBeInTheDocument();

    // Next problem: chapter 3; accept it as reviewed.
    await user.click(within(review).getByRole("button", { name: t.nextProblem }));
    expect(within(review).getByTestId("review-nav")).toHaveTextContent(t.problemNav(2, 2));
    await waitFor(() => expect(within(review).getByTestId("review-reader")).toHaveTextContent("Três."));
    const alert3 = within(review).getByTestId("review-chunk-alert");
    await user.click(within(alert3).getByRole("button", { name: t.markReviewed }));
    expect(engine.calls("translation_mark_reviewed")).toEqual([{ projectId: "p1", chapterIndex: 3, chunkIndex: 0 }]);
    await waitFor(() => expect(within(review).queryByTestId("review-chunk-alert")).not.toBeInTheDocument());
    expect(within(review).getByText(t.reviewedBadge)).toBeInTheDocument();
    expect(engine.calls("translation_verify").length).toBeGreaterThan(1);

    // Whole-chapter retranslation is still available.
    await user.click(within(review).getByRole("button", { name: t.retranslate }));
    expect(engine.calls("translation_retranslate")).toEqual([{ projectId: "p1", chapterIndex: 3 }]);
  });
});
