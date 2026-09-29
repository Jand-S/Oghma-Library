import { createElement as h, type ComponentType, type ReactNode } from "react";
import { BookOpenText } from "lucide-react";
import { discoverHeader } from "../features/discover/DiscoverHeader";
import { DiscoverView } from "../features/discover/DiscoverView";
import type { DiscoverController } from "../features/discover/useDiscoverController";
import type { DownloadsController } from "../features/downloads/useDownloadsController";
import { downloadsHeader } from "../features/downloads/DownloadsHeader";
import { DownloadsView } from "../features/downloads/DownloadsView";
import { KindleView } from "../features/kindle/KindleView";
import { libraryHeader } from "../features/library/LibraryHeader";
import { LibraryView } from "../features/library/LibraryView";
import type { LibraryController } from "../features/library/useLibraryController";
import type { SettingsController } from "../features/settings/useSettingsController";
import type { SourcesController } from "../features/sources/useSourcesController";
import type { TranslationController } from "../features/translation/useTranslationController";
import { navItems, settingsNavItem, type NavItem } from "../shell/nav";
import type { ContentLayout, PageHeaderProps } from "../shell";
import { pageTitleStrings } from "../strings/common";
import { translationHeader } from "../features/translation/TranslationHeader";
import { TranslationView } from "../features/translation/TranslationView";
import { isSettingsCategory, SettingsView } from "../features/settings/SettingsView";
import { sourcesHeader } from "../features/sources/SourcesHeader";
import { SourcesView } from "../features/sources/SourcesView";
import { useNavigation, type AppView, type NavParams } from "./NavigationContext";

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
    loading: app.loading || discover.searching || discover.filters.sourceId === "all",
    searchError: discover.searchError,
    detailNovel: discover.detailNovel,
    detailFromPreview: Boolean(discover.previewNovel),
    filterCollapsed: discover.filtersCollapsed,
    sortDirection: discover.sortDirection,
    adding: discover.adding,
    selectedInLibrary: discover.selectedInLibrary,
    selectedQueued: discover.selectedQueued,
    onFiltersChange: discover.setFilters,
    onSelectNovel: discover.selectNovel,
    onClearSelection: discover.clearSelection,
    onPreviewNovel: discover.openPreviewNovel,
    onClearPreview: discover.clearPreviewNovel,
    onSelectionChange: discover.updateSelection,
    onAddSelected: discover.addSelectedToQueue,
    onRetrySearch: discover.retrySearch,
    onOpenSources: () => app.navigate("sources"),
    onOpenSettings: () => app.navigate("settings")
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
    onOpenSettings: () => app.navigate("settings", { section: "server" })
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
    onNavigate: (view: AppView) => app.navigate(view),
    initialCategory: isSettingsCategory(params.section) ? params.section : undefined
  });
}

const iconFor = (id: AppView) => [...navItems, settingsNavItem].find((item) => item.id === id)?.icon ?? BookOpenText;

export const viewRegistry: Record<AppView, ViewDefinition> = {
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
