import {
  Download,
  Headphones,
  Info,
  Server,
  SlidersHorizontal,
  Tablet,
  type LucideIcon
} from "lucide-react";
import { useCallback, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AppView } from "../../app/NavigationContext";
import type { AppConfig, IndexMode, SourceSite } from "../../core/types";
import { settingsStrings } from "../../strings/settings";
import { cx, useToast } from "../../ui";
import type { ServerCheck } from "../sources/useSourcesController";
import {
  AboutSection,
  AudioSection,
  DownloadsSection,
  GeneralSection,
  KindleSection,
  ServerSection
} from "./SettingsSections";
import "./settings.css";

export const settingsCategories = ["general", "downloads", "server", "kindle", "audio", "about"] as const;
export type SettingsCategory = (typeof settingsCategories)[number];

const categoryIcons: Record<SettingsCategory, LucideIcon> = {
  general: SlidersHorizontal,
  downloads: Download,
  server: Server,
  kindle: Tablet,
  audio: Headphones,
  about: Info
};

export function isSettingsCategory(value: unknown): value is SettingsCategory {
  return typeof value === "string" && (settingsCategories as readonly string[]).includes(value);
}

export type SettingsViewProps = {
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onOpenOnboarding: () => void;
  sources: SourceSite[];
  syncingSourceIds: string[];
  lastSyncedAt: number | null;
  onSyncSources: () => Promise<boolean>;
  serverCheck: ServerCheck;
  onVerifyServer: (serverUrl: string, indexMode: IndexMode) => void;
  kindleConnected: boolean;
  onNavigate: (view: AppView) => void;
  initialCategory?: SettingsCategory;
};

/** Shows a short "Salvo" toast, replacing the previous one so quick edits do not stack. */
function useSavedToast() {
  const { toast, dismiss } = useToast();
  const lastId = useRef<number | null>(null);
  return useCallback(() => {
    if (lastId.current !== null) dismiss(lastId.current);
    lastId.current = toast({ message: settingsStrings.saved, tone: "success", duration: 1600 });
  }, [dismiss, toast]);
}

/**
 * Ajustes: one card with a vertical category list (tabs) on the left and the active
 * category on the right. Every change is saved as soon as it is made (the controller
 * patches `AppConfig`, which is persisted right away); text fields save on blur/Enter
 * after validation, and each save shows a subtle "Salvo" toast.
 */
export function SettingsView(props: SettingsViewProps) {
  const [category, setCategory] = useState<SettingsCategory>(props.initialCategory ?? "general");
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<SettingsCategory, HTMLButtonElement | null>>>({});
  const saved = useSavedToast();

  const save = useCallback((patch: Partial<AppConfig>) => {
    props.onConfigChange(patch);
    saved();
  }, [props, saved]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = settingsCategories.indexOf(category);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = (index + 1) % settingsCategories.length;
    if (event.key === "ArrowUp") next = (index - 1 + settingsCategories.length) % settingsCategories.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = settingsCategories.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = settingsCategories[next];
    setCategory(target);
    tabRefs.current[target]?.focus();
  };

  const tabId = (id: SettingsCategory) => `${baseId}-tab-${id}`;
  const panelId = (id: SettingsCategory) => `${baseId}-panel-${id}`;

  let body: ReactNode;
  switch (category) {
    case "general":
      body = <GeneralSection saved={saved} />;
      break;
    case "downloads":
      body = <DownloadsSection config={props.config} save={save} saved={saved} onNavigate={props.onNavigate} />;
      break;
    case "server":
      body = (
        <ServerSection
          config={props.config}
          save={save}
          sources={props.sources}
          syncingSourceIds={props.syncingSourceIds}
          lastSyncedAt={props.lastSyncedAt}
          onSyncSources={props.onSyncSources}
          serverCheck={props.serverCheck}
          onVerifyServer={props.onVerifyServer}
          onNavigate={props.onNavigate}
        />
      );
      break;
    case "kindle":
      body = <KindleSection config={props.config} save={save} kindleConnected={props.kindleConnected} onNavigate={props.onNavigate} />;
      break;
    case "audio":
      body = <AudioSection config={props.config} save={save} onNavigate={props.onNavigate} />;
      break;
    case "about":
      body = <AboutSection onOpenOnboarding={props.onOpenOnboarding} />;
      break;
  }

  return (
    <div className="settings-page" data-testid="settings-page">
      <div className="settings-card">
        <nav className="settings-nav" aria-label={settingsStrings.navLabel}>
          <div role="tablist" aria-orientation="vertical" aria-label={settingsStrings.navLabel} className="settings-nav__list">
            {settingsCategories.map((id) => {
              const Icon = categoryIcons[id];
              const active = id === category;
              return (
                <button
                  key={id}
                  ref={(element) => {
                    tabRefs.current[id] = element;
                  }}
                  type="button"
                  role="tab"
                  id={tabId(id)}
                  aria-selected={active}
                  aria-controls={panelId(id)}
                  tabIndex={active ? 0 : -1}
                  className={cx("settings-nav__item", active && "is-active")}
                  data-testid={`settings-tab-${id}`}
                  onClick={() => setCategory(id)}
                  onKeyDown={onTabKeyDown}
                >
                  <Icon className="settings-nav__icon" aria-hidden="true" />
                  <span className="settings-nav__label">{settingsStrings.categories[id]}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <section
          key={category}
          role="tabpanel"
          id={panelId(category)}
          aria-labelledby={tabId(category)}
          className="settings-pane"
          data-testid={`settings-section-${category}`}
        >
          <header className="settings-pane__header">
            <h2 className="settings-pane__title">{settingsStrings.categories[category]}</h2>
            <p className="settings-pane__description">{settingsStrings.descriptions[category]}</p>
          </header>
          {body}
        </section>
      </div>
    </div>
  );
}
