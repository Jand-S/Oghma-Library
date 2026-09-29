// Per-version UI adapters: selectors, accessible names and navigation/task steps.
//
// Every script (run.mjs, screens.mjs, usability.mjs) talks to the UI ONLY through these adapters, so
// when the redesign lands you update `newVersion` below (selectors -> [data-testid=...], names, flows)
// and nothing else.
//
// Conventions
//  - `sel.*`   : CSS selectors used for counting/measurement inside the page (must be plain CSS so the
//                in-page probe can use document.querySelectorAll).
//  - `names.*` : accessible names (string = exact match, RegExp = pattern) for role-based locators.
//  - flows     : async functions (page, ...) that perform UI steps. Usability tasks receive an `act`
//                wrapper that counts clicks/keystrokes; flows used by perf/screens take a raw page.
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DESKTOP_DIR = path.resolve(here, ".."); // apps/desktop (current branch)
export const V1_DIR = path.resolve(process.env.OGHMA_V1_DIR || path.join(here, "../../../../v1"));

/** `[data-testid=x]` OR fallback CSS. Lets "new" keep working before/after test ids are added. */
export const tid = (id, fallback) => (fallback ? `[data-testid="${id}"], ${fallback}` : `[data-testid="${id}"]`);

export class TaskImpossible extends Error {
  constructor(reason) {
    super(reason);
    this.name = "TaskImpossible";
  }
}

const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Exact (trimmed) text match for hasText filters. */
export const exactText = (text) => new RegExp(`^\\s*${escapeRe(text)}\\s*$`);

const nameOpt = (name) => (name instanceof RegExp ? { name } : { name, exact: true });

/** Build an adapter. Generic flows are derived from `sel` + `names`; override any flow as needed. */
function makeVersion(def) {
  const v = {
    toastSelector: "[role=status], [role=alert]",
    discoverPageSize: null, // number of cards rendered before "load more" (null = unknown/virtualized)
    maxQueueSelection: Infinity,
    ...def
  };
  const { sel, names } = v;

  v.probeWatchers = () => [
    { name: "shell", selector: sel.shell },
    { name: "splashGone", absent: sel.splash || "#__never__", after: "shell" },
    { name: "firstCard", selector: sel.discoverCard, min: 1 },
    { name: "cards24", selector: sel.discoverCard, min: 24 }
  ];

  v.navButton = (page, view) => {
    const name = names.nav[view];
    const byTestId = page.locator(`[data-testid="nav-${view}"]`);
    const landmark = names.navLandmark ? page.getByRole("navigation", nameOpt(names.navLandmark)) : page.getByRole("navigation");
    const byRole = landmark.getByRole("button", nameOpt(name)).or(landmark.getByRole("link", nameOpt(name)));
    return byTestId.or(byRole).first();
  };

  v.waitShell = v.waitShell || (async (page, { timeout = 20000 } = {}) => {
    await page.locator(sel.shell).first().waitFor({ state: "visible", timeout });
    if (sel.splash) await page.locator(sel.splash).waitFor({ state: "detached", timeout });
  });

  v.waitDiscoverCards = v.waitDiscoverCards || (async (page, min = 24, timeout = 20000) => {
    await page.waitForFunction(
      ([selector, n]) => document.querySelectorAll(selector).length >= n,
      [sel.discoverCard, min],
      { timeout }
    );
  });

  v.goto = v.goto || (async (page, view, act) => {
    const button = v.navButton(page, view);
    if (act) await act.click(button);
    else await button.click();
    const ready = sel.viewReady?.[view];
    if (ready) await page.locator(ready).first().waitFor({ state: "visible", timeout: 15000 });
  });

  v.searchBox = v.searchBox || ((page) => page.locator(sel.discoverSearch).first());
  v.librarySearchBox = v.librarySearchBox || ((page) => page.locator(sel.librarySearch).first());

  v.discoverCardByTitle = v.discoverCardByTitle || ((page, title) =>
    page.locator(sel.discoverCard).filter({ has: page.locator(sel.discoverCardTitle, { hasText: exactText(title) }) }).first());
  v.libraryCardByTitle = v.libraryCardByTitle || ((page, title) =>
    page.locator(sel.libraryCard).filter({ has: page.locator(sel.libraryCardTitle, { hasText: exactText(title) }) }).first());

  return v;
}

// ---------------------------------------------------------------------------------------------
// Legacy UI (v1.0.0 and the current wip branch, which still ships the same views)
// ---------------------------------------------------------------------------------------------
function legacyDef({ id, label, appDir }) {
  return {
    id,
    label,
    appDir,
    distDir: path.join(appDir, "dist-bench"),
    defaultPort: id === "old" ? 4174 : 4173,
    toastSelector: ".app-toast, [role=status]",
    discoverPageSize: 60,
    maxQueueSelection: Infinity, // multi-select, no limit
    sel: {
      shell: "nav[aria-label='Principal']",
      splash: ".splash-screen",
      titlebar: ".titlebar",
      sidebar: ".app-sidebar",
      statusbar: ".statusbar",
      discoverSearch: "#query",
      discoverCard: ".book-grid .book-card:not(.skeleton-card)",
      discoverCardTitle: ".book-info strong",
      discoverCardSelect: ".card-check",
      discoverDetailPanel: ".discover-detail-panel:not(.empty)",
      discoverScroller: ".content-area",
      libraryCard: ".library-book-card",
      libraryCardTitle: ".book-info strong",
      librarySearch: "#library-query",
      libraryDetail: ".library-sidebar",
      downloadRow: ".download-row.pending",
      downloadActiveRow: ".download-row.downloading",
      downloadQueuedRow: ".download-row.queued",
      onboardingDialog: ".setup-panel[role=dialog]",
      kindleConnected: ".kindle-dot.online",
      viewReady: {
        discover: ".content-area",
        downloads: ".downloads-split",
        library: ".library-workspace",
        settings: ".settings-grid"
      }
    },
    names: {
      navLandmark: "Principal",
      nav: { discover: "Buscar", sources: "Fontes", downloads: "Downloads", library: "Biblioteca", translation: "Traducao", settings: "Ajustes" },
      addToQueue: "Adicionar a fila",
      showMore: "Mostrar mais",
      cancel: "Cancelar",
      queueTab: /^Fila/,
      detailsTab: "Detalhes",
      sendToKindle: "Enviar para o Kindle",
      outputFolderLabel: "Pasta de saida"
    }
  };
}

function legacyFlows(v) {
  const { sel, names } = v;

  /** Show at least `min` result cards (clicks "Mostrar mais"). */
  v.expandResults = async (page, min) => {
    for (let i = 0; i < 20; i += 1) {
      const count = await page.locator(sel.discoverCard).count();
      if (count >= min) return count;
      const more = page.getByRole("button", nameOpt(names.showMore));
      if (!(await more.count())) return count;
      await more.click();
      await page.waitForFunction(([s, c]) => document.querySelectorAll(s).length > c, [sel.discoverCard, count]);
    }
    return page.locator(sel.discoverCard).count();
  };

  /** Mark a Discover card for download (v1: the check button keeps the "Fila" tab open). */
  v.selectForDownload = async (page, card, act) => {
    const check = card.locator(sel.discoverCardSelect);
    if (act) await act.click(check);
    else await check.click();
  };

  v.addSelectedToQueue = async (page, act) => {
    const button = page.getByRole("button", nameOpt(names.addToQueue));
    if (act) await act.click(button);
    else await button.click();
    // v1 animates the cards into the Downloads icon (~620ms + 110ms/book) before enqueueing.
    await page.waitForFunction(
      () => /adicionados a fila|na fila|adicionad/i.test(document.querySelector(".app-toast")?.textContent || ""),
      null,
      { timeout: 15000 }
    );
  };

  /** Enqueue up to n books; returns how many the UI accepted. */
  v.enqueueMany = async (page, n) => {
    const target = Math.min(n, v.maxQueueSelection);
    await v.expandResults(page, target);
    const cards = page.locator(sel.discoverCard);
    for (let i = 0; i < target; i += 1) await v.selectForDownload(page, cards.nth(i));
    const accepted = await page
      .locator(sel.discoverCard)
      .and(page.locator('.selected, [data-selected="true"], [aria-selected="true"], [aria-pressed="true"]'))
      .count();
    await v.addSelectedToQueue(page);
    return accepted;
  };

  v.openDiscoverDetail = async (page) => {
    await page.locator(sel.discoverCard).first().click({ button: "right" });
    await page.locator(sel.discoverDetailPanel).first().waitFor({ state: "visible" });
  };

  v.openLibraryDetail = async (page) => {
    await page.locator(sel.libraryCard).first().click();
    await page.locator(sel.libraryDetail).first().waitFor({ state: "visible" });
  };

  /** Cancel the active download from the Downloads view; returns its title. */
  v.cancelActiveDownload = async (page, act) => {
    const row = page.locator(sel.downloadActiveRow).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    const title = (await row.locator("strong").first().textContent())?.trim();
    const button = row.getByRole("button", nameOpt(names.cancel));
    if (act) await act.click(button);
    else await button.click();
    return title;
  };

  // ---------------- usability tasks (act counts clicks/keys) ----------------
  v.tasks = {
    async downloadOne({ page, act, target }) {
      await act.fill(v.searchBox(page), target.query);
      const card = v.discoverCardByTitle(page, target.title);
      await card.waitFor({ state: "visible" });
      await v.selectForDownload(page, card, act);
      await v.addSelectedToQueue(page, act);
    },
    async cancelActive({ page, act }) {
      await v.goto(page, "downloads", act);
      return v.cancelActiveDownload(page, act);
    },
    async redownload({ page, act, target }) {
      // v1 has no "download again" action in the Library: the user must find the book in Discover.
      await v.goto(page, "discover", act);
      await act.fill(v.searchBox(page), target.query);
      const card = v.discoverCardByTitle(page, target.title);
      await card.waitFor({ state: "visible" });
      await v.selectForDownload(page, card, act);
      await v.addSelectedToQueue(page, act);
      return { note: "no re-download action in Library; done via Discover search + queue" };
    },
    async sendToKindle({ page, act, target }) {
      await act.fill(v.librarySearchBox(page), target.query);
      const card = v.libraryCardByTitle(page, target.title);
      await card.waitFor({ state: "visible" });
      await act.click(card); // selects + opens "Detalhes" tab
      await act.click(page.getByRole("tab", nameOpt(names.queueTab)));
      await act.click(page.getByRole("button", nameOpt(names.sendToKindle)));
    },
    async changeOutputFolder({ page, act, newPath }) {
      await v.goto(page, "settings", act);
      const label = names.outputFolderLabel;
      const input = page
        .getByLabel(label, nameOpt(label).exact ? { exact: true } : {})
        .or(page.locator(".field-group").filter({ has: page.locator("label", { hasText: label }) }).locator("input"))
        .first();
      await act.click(input);
      const cleared = await act.clearField(input);
      await act.type(input, newPath);
      return {
        note: `free-text input (no folder picker)${cleared.selectAllWorked ? "" : "; Ctrl/Cmd+A does not select (app cancels selectstart) -> cleared with End + Backspace per char"}`
      };
    }
  };
  return v;
}

export const oldVersion = legacyFlows(makeVersion(legacyDef({ id: "old", label: "v1.0.0", appDir: V1_DIR })));

// ---------------------------------------------------------------------------------------------
// New UI (placeholder = current wip branch UI). Uses testid-OR-legacy selectors and tolerant names
// so it keeps working while the redesign adds data-testids. Update here when the redesign lands.
// ---------------------------------------------------------------------------------------------
const newDef = legacyDef({ id: "new", label: "wip (current branch)", appDir: DESKTOP_DIR });
newDef.sel = {
  ...newDef.sel,
  shell: tid("app-shell", newDef.sel.shell),
  titlebar: tid("titlebar", newDef.sel.titlebar),
  discoverSearch: tid("discover-search", newDef.sel.discoverSearch),
  discoverCard: tid("discover-card", newDef.sel.discoverCard),
  discoverCardTitle: tid("card-title", newDef.sel.discoverCardTitle),
  discoverCardSelect: tid("card-select", newDef.sel.discoverCardSelect),
  discoverDetailPanel: tid("discover-detail", newDef.sel.discoverDetailPanel),
  libraryCard: tid("library-card", newDef.sel.libraryCard),
  libraryCardTitle: tid("card-title", newDef.sel.libraryCardTitle),
  librarySearch: tid("library-search", newDef.sel.librarySearch),
  libraryDetail: tid("library-detail", newDef.sel.libraryDetail),
  downloadRow: tid("download-row", newDef.sel.downloadRow),
  downloadActiveRow: tid("download-active", newDef.sel.downloadActiveRow),
  downloadQueuedRow: tid("download-queued", newDef.sel.downloadQueuedRow),
  onboardingDialog: tid("onboarding", newDef.sel.onboardingDialog),
  kindleConnected: tid("kindle-connected", newDef.sel.kindleConnected)
};
newDef.names = {
  ...newDef.names,
  navLandmark: /Principal|Main/i,
  nav: {
    discover: /^(Buscar|Descobrir|Explorar)$/,
    sources: /^Fontes$/,
    downloads: /^Downloads?$/,
    library: /^Biblioteca$/,
    translation: /^Tradu[cç][aã]o$/,
    settings: /^(Ajustes|Configura[cç][oõ]es)$/
  },
  addToQueue: /^(Adicionar [aà] fila|Baixar)$/,
  showMore: /^Mostrar mais$/,
  cancel: /^Cancelar$/,
  sendToKindle: /^Enviar (para o|ao) Kindle$/,
  outputFolderLabel: "Pasta de saida"
};
export const newVersion = legacyFlows(makeVersion(newDef));
// When the redesign lands, expected changes (see README "Updating versions.mjs"):
//  - newVersion.maxQueueSelection = 1 (1 active + queue: enqueueMany() should enqueue one-by-one)
//  - newVersion.discoverPageSize = null if the grid is virtualized/infinite
//  - sel.splash: remove if there is no splash overlay
//  - tasks.redownload: use the Library's "Baixar novamente" action
//  - tasks.changeOutputFolder: click the folder picker (shim answers plugin:dialog|open)

export const versions = { old: oldVersion, new: newVersion };
