import { createElement as h, type ComponentType } from "react";
import { BookOpenText, Tablet } from "lucide-react";
import type { DiscoverController } from "../features/discover/useDiscoverController";
import type { DownloadsController } from "../features/downloads/useDownloadsController";
import { DownloadsView } from "../features/downloads/DownloadsView";
import { canRedownload, type LibraryController } from "../features/library/useLibraryController";
import type { SettingsController } from "../features/settings/useSettingsController";
import type { SourcesController } from "../features/sources/useSourcesController";
import type { TranslationController } from "../features/translation/useTranslationController";
import { navItems, settingsNavItem, type NavItem } from "../shell/nav";
import { pageTitleStrings, shellStrings } from "../strings/common";
import { Button, EmptyState } from "../ui";
import { DiscoverView } from "../views/discover";
import { LibraryView } from "../views/library";
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
    onPause: downloads.pause,
    onResume: downloads.resume,
    onCancel: downloads.cancel,
    onMove: downloads.move,
    onReorder: downloads.reorder,
    onRemove: downloads.remove,
    onRetry: downloads.retry,
    onClearCompleted: downloads.clearCompleted,
    onOpenFolder: downloads.openJobFolder
  });
}

function LibraryPage({ app }: ViewProps) {
  const library = app.library;
  const conversion = library.conversion;
  return h(LibraryView, {
    library: library.library,
    kindleConnected: library.kindleConnected,
    selectedIds: library.selectedLibraryIds,
    onToggleSelect: library.toggleLibrarySelect,
    conversionFormats: conversion.converterFormats,
    conversionAudiobook: conversion.converterAudiobook,
    conversionProgress: conversion.converterProgress,
    conversionRunning: conversion.converterRunning,
    conversionCurrentItemId: conversion.converterCurrentItemId,
    onConvertSelected: conversion.startConversion,
    onToggleConversionFormat: conversion.toggleConverterFormat,
    onToggleConversionAudiobook: conversion.toggleConverterAudiobook,
    onRemoveSelected: library.removeSelectedLibraryItem,
    onReorderSelected: library.setSelectedLibraryIds,
    onOpenItemFolder: library.openLibraryItemFolder,
    onUpdateMeta: library.updateLibraryMeta,
    onDeleteItems: library.deleteLibraryItems,
    onRedownload: library.redownloadItem,
    canRedownload,
    isQueued: app.downloads.isQueued
  });
}

/**
 * Kindle: the Library already switches its queue to "send to Kindle" mode
 * while a device is connected, so this view reuses it. Without a device it
 * shows how to connect one. A dedicated Kindle page comes in a later phase.
 */
function KindlePage({ app }: ViewProps) {
  if (app.library.kindleConnected) return h(LibraryPage, { app });
  return h(
    "div",
    { className: "o-app__center" },
    h(EmptyState, {
      icon: h(Tablet),
      title: pageTitleStrings.kindle,
      description: shellStrings.kindlePageDescription,
      action: h(Button, { variant: "primary", icon: h(BookOpenText), onClick: () => app.navigate("library") }, shellStrings.kindleOpenLibrary)
    })
  );
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
  downloads: {
    id: "downloads",
    title: pageTitleStrings.downloads,
    icon: iconFor("downloads"),
    component: DownloadsPage,
    contentClassName: () => "o-app__content--scroll downloads-content"
  },
  library: { id: "library", title: pageTitleStrings.library, icon: iconFor("library"), component: LibraryPage },
  kindle: { id: "kindle", title: pageTitleStrings.kindle, icon: iconFor("kindle"), component: KindlePage },
  translation: { id: "translation", title: pageTitleStrings.translation, icon: iconFor("translation"), component: TranslationPage },
  sources: { id: "sources", title: pageTitleStrings.sources, icon: iconFor("sources"), component: SourcesPage },
  settings: { id: "settings", title: pageTitleStrings.settings, icon: iconFor("settings"), component: SettingsPage }
};

export function contentClassFor(view: AppView, app: AppControllers) {
  return viewRegistry[view].contentClassName?.(app) ?? LEGACY_SINGLE;
}
