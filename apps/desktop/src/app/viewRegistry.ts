import { createElement as h, type ComponentType } from "react";
import { BookOpenText } from "lucide-react";
import type { DiscoverController } from "../features/discover/useDiscoverController";
import type { DownloadsController } from "../features/downloads/useDownloadsController";
import { KindleView } from "../features/kindle/KindleView";
import { LibraryView } from "../features/library/LibraryView";
import type { LibraryController } from "../features/library/useLibraryController";
import type { SettingsController } from "../features/settings/useSettingsController";
import type { SourcesController } from "../features/sources/useSourcesController";
import type { TranslationController } from "../features/translation/useTranslationController";
import { navItems, settingsNavItem, type NavItem } from "../shell/nav";
import { pageTitleStrings } from "../strings/common";
import { DiscoverView } from "../views/discover";
import { DownloadsView } from "../views/downloads";
import { SettingsView } from "../views/settings";
import { SourcesView } from "../views/sources";
import { TranslationView } from "../views/translation";
import type { AppView, NavParams } from "./NavigationContext";

/** Everything a view needs, assembled by App from the feature controllers. */
export type AppControllers = {
  loading: boolean;
  navigate: (view: AppView, params?: NavParams) => void;
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
  /** Classes for the content area; legacy views rely on the `workspace …` grid. */
  contentClassName?: (app: AppControllers) => string;
};

const LEGACY_SINGLE = "workspace single";

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
    detailNovel: discover.detailNovel,
    detailFromPreview: Boolean(discover.previewNovel),
    filterCollapsed: discover.filtersCollapsed,
    adding: discover.adding,
    selectedInLibrary: discover.selectedInLibrary,
    selectedQueued: discover.selectedQueued,
    onFiltersChange: discover.setFilters,
    onToggleFilters: discover.toggleFilters,
    onSelectNovel: discover.selectNovel,
    onPreviewNovel: discover.openPreviewNovel,
    onClearPreview: discover.clearPreviewNovel,
    onSelectionChange: discover.updateSelection,
    onAddSelected: discover.addSelectedToQueue
  });
}

function DownloadsPage({ app }: ViewProps) {
  const downloads = app.downloads;
  return h(DownloadsView, {
    activeJob: downloads.activeJob,
    queuedJobs: downloads.queuedJobs,
    completedJobs: downloads.completedJobs,
    paused: downloads.paused,
    onPauseToggle: downloads.togglePaused,
    onCancel: downloads.cancel,
    onMove: downloads.move,
    onRemove: downloads.remove,
    onRetry: downloads.retry,
    onClearCompleted: downloads.clearCompleted,
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
  return h(TranslationView, app.translation);
}

function SourcesPage({ app }: ViewProps) {
  const sources = app.sources;
  return h(SourcesView, { sources: sources.sources, syncing: sources.syncing, onToggle: sources.toggleSourceEnabled, onSync: sources.syncSource });
}

function SettingsPage({ app }: ViewProps) {
  const settings = app.settings;
  return h(SettingsView, { config: settings.config, onConfigChange: settings.patchConfig, onOpenOnboarding: settings.openOnboarding });
}

const iconFor = (id: AppView) => [...navItems, settingsNavItem].find((item) => item.id === id)?.icon ?? BookOpenText;

export const viewRegistry: Record<AppView, ViewDefinition> = {
  discover: {
    id: "discover",
    title: pageTitleStrings.discover,
    icon: iconFor("discover"),
    component: DiscoverPage,
    contentClassName: (app) => app.discover.workspaceClassName
  },
  downloads: { id: "downloads", title: pageTitleStrings.downloads, icon: iconFor("downloads"), component: DownloadsPage },
  library: { id: "library", title: pageTitleStrings.library, icon: iconFor("library"), component: LibraryPage, contentClassName: () => "library-content" },
  kindle: { id: "kindle", title: pageTitleStrings.kindle, icon: iconFor("kindle"), component: KindlePage, contentClassName: () => "kindle-content" },
  translation: { id: "translation", title: pageTitleStrings.translation, icon: iconFor("translation"), component: TranslationPage },
  sources: { id: "sources", title: pageTitleStrings.sources, icon: iconFor("sources"), component: SourcesPage },
  settings: { id: "settings", title: pageTitleStrings.settings, icon: iconFor("settings"), component: SettingsPage }
};

export function contentClassFor(view: AppView, app: AppControllers) {
  return viewRegistry[view].contentClassName?.(app) ?? LEGACY_SINGLE;
}
