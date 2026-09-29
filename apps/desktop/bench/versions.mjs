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
// New UI (redesign branch): data-testid selectors only (no legacy fallbacks).
// Download model: ONE book selected at a time in Discover, enqueued with the detail panel's
// "Baixar" button (1 active + up to 10 queued); cancel asks for confirmation.
// ---------------------------------------------------------------------------------------------
const newDef = {
  id: "new",
  label: "redesign (current branch)",
  appDir: DESKTOP_DIR,
  distDir: path.join(DESKTOP_DIR, "dist-bench"),
  defaultPort: 4173,
  toastSelector: ".o-toast-region [role=status], .o-toast-region [role=alert]",
  discoverPageSize: 60, // DISCOVER_PAGE_SIZE: "Mostrar mais" / infinite scroll adds 60 more
  maxQueueSelection: 11, // 1 active + MAX_QUEUED (10), enqueued one by one
  sel: {
    shell: tid("app-shell"),
    splash: tid("splash-screen"),
    titlebar: tid("titlebar"),
    sidebar: tid("sidebar"),
    statusbar: tid("bottom-panel"),
    pageHeader: tid("page-header"),
    discoverSearch: tid("discover-search"),
    discoverCard: tid("book-card"),
    discoverCardTitle: tid("card-title"),
    discoverCardSelect: tid("card-select"),
    discoverDetailPanel: tid("discover-detail-panel"),
    discoverScroller: tid("content-area"),
    discoverAddButton: tid("add-to-queue"),
    libraryCard: tid("library-card"),
    libraryCardTitle: tid("card-title"),
    librarySearch: tid("library-search"),
    libraryDetail: tid("library-detail"),
    libraryRedownload: tid("library-redownload"),
    downloadRow: `${tid("download-active")}, ${tid("download-queued")}`,
    downloadActiveRow: tid("download-active"),
    downloadQueuedRow: tid("download-queued"),
    settingsTabDownloads: tid("settings-tab-downloads"),
    outputFolderPicker: tid("pick-output-folder"),
    onboardingDialog: tid("onboarding"),
    onboardingStep: tid("onboarding-step"),
    kindleConnected: '[data-testid="bottom-panel-kindle"][data-connected="true"]',
    viewReady: {
      discover: tid("content-area"),
      downloads: `${tid("downloads-pending")}, ${tid("downloads-completed")}, .downloads-page`,
      library: tid("library-page"),
      kindle: tid("kindle-page"),
      sources: tid("sources-page"),
      settings: tid("settings-page")
    }
  },
  names: {
    navLandmark: "Principal",
    nav: {
      discover: "Buscar",
      sources: "Fontes",
      downloads: "Downloads",
      library: "Biblioteca",
      kindle: "Kindle",
      translation: "Tradução",
      settings: "Ajustes"
    },
    onboardingHeading: "Bem-vindo ao Oghma Library",
    addToQueue: /^(Baixar|Baixar novamente)$/,
    showMore: "Mostrar mais",
    cancel: "Cancelar",
    confirmCancel: "Cancelar download",
    redownload: "Baixar novamente",
    sendToKindle: "Enviar ao Kindle"
  }
};
/** Queue feedback toasts (added / started / duplicate / full). */
const ENQUEUE_TOAST = /Adicionado [aà] fila|Download iniciado|j[aá] est[aá] na fila|fila est[aá] cheia/i;

function newFlows(v) {
  legacyFlows(v); // shared: expandResults ("Mostrar mais"); everything else is overridden below
  const { sel, names } = v;

  /** Marks the current toasts so waitNewToast only matches toasts shown afterwards. */
  const markToastsSeen = (page) =>
    page.evaluate((selector) => {
      document.querySelectorAll(selector).forEach((node) => { node.dataset.benchSeen = "1"; });
    }, v.toastSelector);
  const waitNewToast = (page, pattern) =>
    page.waitForFunction(
      ([selector, source, flags]) => {
        const re = new RegExp(source, flags);
        return Array.from(document.querySelectorAll(selector)).some((node) => !node.dataset.benchSeen && re.test(node.textContent || ""));
      },
      [v.toastSelector, pattern.source, pattern.flags],
      { timeout: 15000 }
    );

  /** Single select: clicking the card selects exactly one book and opens the detail panel. */
  v.selectForDownload = async (page, card, act) => {
    const check = card.locator(sel.discoverCardSelect).first();
    const target = (await check.count()) ? check : card;
    if (act) await act.click(target);
    else await target.click();
    await page.locator(sel.discoverDetailPanel).first().waitFor({ state: "visible", timeout: 10000 });
    await page.locator(sel.discoverAddButton).first().waitFor({ state: "visible", timeout: 10000 });
  };

  /** "Baixar" (or "Baixar novamente") in the detail panel. */
  v.addSelectedToQueue = async (page, act) => {
    const button = page.locator(sel.discoverAddButton).filter({ hasText: names.addToQueue }).first();
    await markToastsSeen(page);
    if (act) await act.click(button);
    else await button.click();
    await waitNewToast(page, ENQUEUE_TOAST);
  };

  /** Enqueue up to n books one by one (select -> Baixar); returns how many the queue accepted. */
  v.enqueueMany = async (page, n) => {
    const target = Math.min(n, v.maxQueueSelection);
    await v.expandResults(page, target);
    const cards = page.locator(sel.discoverCard);
    let accepted = 0;
    for (let i = 0; i < target; i += 1) {
      await v.selectForDownload(page, cards.nth(i));
      const before = await page.evaluate(() => (window.__BENCH_PROBE__?.toasts || []).length);
      await v.addSelectedToQueue(page);
      const texts = await page.evaluate((b) => (window.__BENCH_PROBE__?.toasts || []).slice(b).map((t) => t.text), before);
      if (texts.some((text) => /Adicionado|Download iniciado/i.test(text))) accepted += 1;
    }
    return accepted;
  };

  /** Detail panel: right-click previews a book without selecting it. */
  v.openDiscoverDetail = async (page) => {
    await page.locator(sel.discoverCard).first().click({ button: "right" });
    await page.locator(sel.discoverDetailPanel).first().waitFor({ state: "visible" });
  };

  /** Library: the card title opens the details page. */
  v.openLibraryDetail = async (page) => {
    await page.locator(sel.libraryCard).first().locator(sel.libraryCardTitle).first().click();
    await page.locator(sel.libraryDetail).first().waitFor({ state: "visible" });
  };

  /** Cancel the active download ("Cancelar" -> confirmation "Cancelar download"); returns its title. */
  v.cancelActiveDownload = async (page, act) => {
    const row = page.locator(sel.downloadActiveRow).first();
    await row.waitFor({ state: "visible", timeout: 15000 });
    const title = (await row.getAttribute("aria-label"))?.trim();
    const button = row.getByRole("button", nameOpt(names.cancel));
    if (act) await act.click(button);
    else await button.click();
    const confirm = page.getByRole("dialog").getByRole("button", nameOpt(names.confirmCancel));
    if (act) await act.click(confirm);
    else await confirm.click();
    await page.locator(sel.downloadActiveRow).filter({ hasText: title || "__none__" }).first()
      .waitFor({ state: "detached", timeout: 15000 }).catch(() => undefined);
    return title;
  };

  /**
   * Library cards show the catalog title (matched by novel id), while the harness may pass the
   * folder name, where sanitizeFileName turned characters such as ":" into "_".
   */
  const libraryTitlePattern = (title) =>
    new RegExp(`^\\s*${escapeRe(title).replace(/_/g, '[_<>:"/\\\\|?*]')}\\s*$`);

  /** Opens a library book's details page (search, then the card title). */
  const openLibraryBook = async (page, act, target) => {
    await act.fill(v.librarySearchBox(page), target.query);
    const card = page.locator(sel.libraryCard)
      .filter({ has: page.locator(sel.libraryCardTitle, { hasText: libraryTitlePattern(target.title) }) })
      .first();
    await card.waitFor({ state: "visible" });
    await act.click(card.locator(sel.libraryCardTitle).first());
    await page.locator(sel.libraryDetail).first().waitFor({ state: "visible" });
  };

  v.tasks = {
    async downloadOne({ page, act, target }) {
      await act.fill(v.searchBox(page), target.query);
      const card = v.discoverCardByTitle(page, target.title);
      await card.waitFor({ state: "visible" });
      await v.selectForDownload(page, card, act);
      await v.addSelectedToQueue(page, act);
      return { note: "card -> detail panel -> Baixar" };
    },
    async cancelActive({ page, act }) {
      await v.goto(page, "downloads", act);
      return v.cancelActiveDownload(page, act);
    },
    async redownload({ page, act, target }) {
      await openLibraryBook(page, act, target);
      await act.click(page.locator(sel.libraryRedownload).first());
      return { note: "Library card -> details -> Baixar novamente" };
    },
    async sendToKindle({ page, act, target }) {
      await openLibraryBook(page, act, target);
      await act.click(page.locator(sel.libraryDetail).getByRole("button", nameOpt(names.sendToKindle)).first());
      return { note: "Library card -> details -> Enviar ao Kindle" };
    },
    async changeOutputFolder({ page, act }) {
      await v.goto(page, "settings", act);
      await act.click(page.locator(sel.settingsTabDownloads).first());
      await act.click(page.locator(sel.outputFolderPicker).first()); // shim answers plugin:dialog|open
      return { note: "Ajustes -> Downloads -> Escolher… (native folder picker)" };
    }
  };
  return v;
}

export const newVersion = newFlows(makeVersion(newDef));

export const versions = { old: oldVersion, new: newVersion };
