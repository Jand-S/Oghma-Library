import { createElement as h, lazy, type ComponentType, type ReactNode } from "react";
import { BookOpenText } from "lucide-react";
import { defaultFilters } from "../core/defaults";
import type { LibraryItem, Novel } from "../core/types";
import type { HomeSeeAll } from "../features/home/HomeView";
import { discoverHeader } from "../features/discover/DiscoverHeader";
import { DiscoverView } from "../features/discover/DiscoverView";
import type { DiscoverController } from "../features/discover/useDiscoverController";
import type { DownloadsController } from "../features/downloads/useDownloadsController";
import { downloadsHeader } from "../features/downloads/DownloadsHeader";
import { libraryHeader } from "../features/library/LibraryHeader";
import type { LibraryController } from "../features/library/useLibraryController";
import type { SettingsController } from "../features/settings/useSettingsController";
import type { SourcesController } from "../features/sources/useSourcesController";
import type { TranslationController } from "../features/translation/useTranslationController";
import type { AccountController } from "./account";
import { navItems, settingsNavItem, type NavItem } from "../shell/nav";
import type { ContentLayout, PageHeaderProps } from "../shell";
import { pageTitleStrings } from "../strings/common";
import { translationHeader } from "../features/translation/TranslationHeader";
import { isSettingsCategory } from "../features/settings/categories";
import { sourcesHeader } from "../features/sources/SourcesHeader";
import { useNavigation, type AppView, type NavParams } from "./NavigationContext";

// Secondary views are split into their own chunks and prefetched after boot (see preloadViews).
// Once a chunk is cached the view renders directly, skipping Suspense: React 19 holds a revealed
// Suspense boundary for ~300ms, which would make every navigation feel slow.
function lazyView<P extends object>(load: () => Promise<ComponentType<P>>) {
  let loaded: ComponentType<P> | null = null;
  const preload = () => load().then((component) => (loaded = component));
  const Lazy = lazy(() => preload().then((component) => ({ default: component })));
  function LazyView(props: P) {
    return loaded ? h(loaded, props) : h(Lazy as unknown as ComponentType<P>, props);
  }
  return { View: LazyView, preload };
}

const homeView = lazyView(() => import("../features/home/HomeView").then((m) => m.HomeView));
const downloadsView = lazyView(() => import("../features/downloads/DownloadsView").then((m) => m.DownloadsView));
const kindleView = lazyView(() => import("../features/kindle/KindleView").then((m) => m.KindleView));
const libraryView = lazyView(() => import("../features/library/LibraryView").then((m) => m.LibraryView));
const translationView = lazyView(() => import("../features/translation/TranslationView").then((m) => m.TranslationView));
const settingsView = lazyView(() => import("../features/settings/SettingsView").then((m) => m.SettingsView));
const sourcesView = lazyView(() => import("../features/sources/SourcesView").then((m) => m.SourcesView));

const HomeView = homeView.View;
const DownloadsView = downloadsView.View;
const KindleView = kindleView.View;
const LibraryView = libraryView.View;
const TranslationView = translationView.View;
const SettingsView = settingsView.View;
const SourcesView = sourcesView.View;

/** Warms every lazy view chunk so later navigation never waits on disk or suspends. */
export function preloadViews() {
  return Promise.all([homeView, downloadsView, kindleView, libraryView, translationView, settingsView, sourcesView].map((view) => view.preload()));
}

/** Everything a view needs, assembled by App from the feature controllers. */
export type AppControllers = {
  loading: boolean;
  navigate: (view: AppView, params?: NavParams) => void;
  /** Params of the current navigation entry (e.g. `{ book }` on the Library details). */
  params: NavParams;
  discover: DiscoverController;
  downloads: DownloadsController;
  library: LibraryController;
  settings: SettingsController;
  sources: SourcesController;
  translation: TranslationController;
  /** ChatGPT account (one source of truth for Tradução, Buscar and Ajustes). */
  account: AccountController;
};

export type ViewProps = { app: AppControllers };

export type ViewDefinition = {
  id: AppView;
  title: string;
  icon: NavItem["icon"];
  component: ComponentType<ViewProps>;
  /**
   * Content-area variant (`shell/layout.css`): "scroll" pages scroll as a whole;
   * "fill" (full-bleed/split) views get the exact visible height and scroll inside.
   */
  layout: ContentLayout;
  /** PageHeader content for the view: badge next to the title, search and right-side actions. */
  header?: (app: AppControllers) => ViewHeader;
};

/**
 * What a view puts in the PageHeader. `onBackgroundClick` fires on clicks that do not
 * hit a control (Discover uses it to dismiss a preview).
 */
export type ViewHeader = Partial<Pick<PageHeaderProps, "search" | "actions" | "onBackgroundClick">> & { badge?: ReactNode };

function DiscoverPage({ app }: ViewProps) {
  const discover = app.discover;
  return h(DiscoverView, {
    sources: app.sources.sources,
    filters: discover.filters,
    tagCatalog: discover.tagCatalog,
    results: discover.results,
    selectedNovel: discover.selectedNovel ?? undefined,
    selection: discover.selection,
    // Results already on screen stay while a new search runs (no skeleton flash on each keystroke).
    loading: app.loading || (discover.searching && discover.results.length === 0),
    searchError: discover.searchError,
    detailNovel: discover.detailNovel,
    detailFromPreview: Boolean(discover.previewNovel),
    sortDirection: discover.sortDirection,
    adding: discover.adding,
    selectedInLibrary: discover.selectedInLibrary,
    selectedQueued: discover.selectedQueued,
    onFiltersChange: discover.setFilters,
    onSelectNovel: discover.selectNovel,
    onClearSelection: discover.clearSelection,
    onPreviewNovel: discover.openPreviewNovel,
    related: discover.related,
    smart: discover.smart,
    smartBusy: discover.smartBusy,
    smartStage: discover.smartStage,
    onClearSmart: discover.clearSmart,
    onClearPreview: discover.clearPreviewNovel,
    onSelectionChange: discover.updateSelection,
    onAddSelected: discover.addSelectedToQueue,
    onRetrySearch: discover.retrySearch,
    onOpenSources: () => app.navigate("sources"),
    onOpenSettings: () => app.navigate("settings")
  });
}

function HomePage({ app }: ViewProps) {
  const { discover, library, sources, navigate } = app;
  return h(HomeView, {
    catalogIndex: discover.catalogIndex,
    library: library.library,
    sourceIds: sources.sources.filter((source) => source.enabled).map((source) => source.id),
    loading: app.loading,
    onOpenNovel: (novel: Novel) => {
      navigate("discover");
      discover.openPreviewNovel(novel);
    },
    onOpenBook: (item: LibraryItem) => navigate("library", { book: item.id }),
    onSeeAll: ({ sort, status }: HomeSeeAll) => {
      discover.setFilters({ ...defaultFilters("all"), ...(status ? { status } : {}) });
      discover.setSortDirection(sort === "title" ? "asc" : sort);
      navigate("discover");
    },
    onBrowseTag: (key: string) => {
      discover.setFilters({ ...defaultFilters("all"), includeTags: [key] });
      navigate("discover");
    },
    onOpenLibrary: () => navigate("library")
  });
}

function DownloadsPage({ app }: ViewProps) {
  const downloads = app.downloads;
  return h(DownloadsView, {
    activeJob: downloads.activeJob,
    queuedJobs: downloads.queuedJobs,
    completedJobs: downloads.completedJobs,
    paused: downloads.paused,
    onPause: downloads.pause,
    onResume: downloads.resume,
    onCancel: downloads.cancel,
    onMove: downloads.move,
    onReorder: downloads.reorder,
    onRemove: downloads.remove,
    onRetry: downloads.retry,
    onOpenFolder: downloads.openJobFolder
  });
}

function LibraryPage({ app }: ViewProps) {
  return h(LibraryView, {
    library: app.library,
    activeJob: app.downloads.activeJob,
    queuedJobs: app.downloads.queuedJobs,
    loading: app.loading,
    navigate: app.navigate
  });
}

/** Kindle: device status plus the "Enviar ao Kindle" flow over the library. */
function KindlePage({ app }: ViewProps) {
  return h(KindleView, { library: app.library, activeJob: app.downloads.activeJob, navigate: app.navigate });
}

function TranslationPage({ app }: ViewProps) {
  return h(TranslationView, { controller: app.translation, onBrowse: () => app.navigate("discover") });
}

function SourcesPage({ app }: ViewProps) {
  const sources = app.sources;
  return h(SourcesView, {
    sources: sources.sources,
    syncing: sources.syncing,
    loading: app.loading,
    novels: app.discover.results,
    onToggle: sources.toggleSourceEnabled,
    onSync: sources.syncSource,
    onAddSource: sources.addSource,
    onPeekSources: sources.peekIndexSources,
    onNotify: sources.notify,
    onOpenSettings: () => app.navigate("settings", { section: "server" }),
    requestOpen: sources.requestOpen,
    onRequestOpenChange: sources.setRequestOpen
  });
}

/** Ajustes; `navigate("settings", { section: "server" })` opens a given category. */
function SettingsPage({ app }: ViewProps) {
  const { params } = useNavigation();
  const settings = app.settings;
  const sources = app.sources;
  return h(SettingsView, {
    config: settings.config,
    onConfigChange: settings.patchConfig,
    onOpenOnboarding: settings.openOnboarding,
    sources: sources.sources,
    syncingSourceIds: sources.syncing,
    lastSyncedAt: sources.lastSyncedAt,
    onSyncSources: sources.syncEnabledSources,
    serverCheck: sources.serverCheck,
    onVerifyServer: sources.verifyServer,
    kindleConnected: app.library.kindleConnected,
    kindleStatus: app.library.kindleStatus,
    onNavigate: (view: AppView) => app.navigate(view),
    account: app.account,
    onRetryAccount: () => void app.translation.refreshAccount(),
    initialCategory: isSettingsCategory(params.section) ? params.section : undefined
  });
}

const iconFor = (id: AppView) => [...navItems, settingsNavItem].find((item) => item.id === id)?.icon ?? BookOpenText;

export const viewRegistry: Record<AppView, ViewDefinition> = {
  home: {
    id: "home",
    title: pageTitleStrings.home,
    icon: iconFor("home"),
    component: HomePage,
    layout: "scroll"
  },
  discover: {
    id: "discover",
    title: pageTitleStrings.discover,
    icon: iconFor("discover"),
    component: DiscoverPage,
    layout: "fill",
    header: discoverHeader
  },
  downloads: {
    id: "downloads",
    title: pageTitleStrings.downloads,
    icon: iconFor("downloads"),
    component: DownloadsPage,
    layout: "scroll",
    header: downloadsHeader
  },
  library: {
    id: "library",
    title: pageTitleStrings.library,
    icon: iconFor("library"),
    component: LibraryPage,
    layout: "fill",
    header: libraryHeader
  },
  kindle: { id: "kindle", title: pageTitleStrings.kindle, icon: iconFor("kindle"), component: KindlePage, layout: "scroll" },
  translation: {
    id: "translation",
    title: pageTitleStrings.translation,
    icon: iconFor("translation"),
    component: TranslationPage,
    layout: "fill",
    header: translationHeader
  },
  sources: {
    id: "sources",
    title: pageTitleStrings.sources,
    icon: iconFor("sources"),
    component: SourcesPage,
    layout: "scroll",
    header: sourcesHeader
  },
  settings: { id: "settings", title: pageTitleStrings.settings, icon: iconFor("settings"), component: SettingsPage, layout: "scroll" }
};
