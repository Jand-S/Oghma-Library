import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { AppView } from "../app/NavigationContext";
import { cx } from "../ui";
import { BottomPanel, type BottomPanelProps } from "./BottomPanel";
import { PageHeader, type PageHeaderProps } from "./PageHeader";
import { getPlatform, type Platform } from "./platform";
import { clampSidebarWidth, Sidebar, SIDEBAR_WIDTH, type SidebarStatus } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const WIDTH_KEY = "oghma.sidebar.width";
const COLLAPSED_KEY = "oghma.sidebar.collapsed";

function readNumber(key: string, fallback: number) {
  try {
    const value = Number(window.localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function readFlag(key: string) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable (private mode); the preference just is not remembered.
  }
}

export type AppShellProps = {
  active: AppView;
  onNavigate: (view: AppView) => void;
  sidebarStatus?: SidebarStatus;
  header: PageHeaderProps;
  bottomPanel: BottomPanelProps;
  /** Class names for the content area (legacy views use `workspace …` grid classes). */
  contentClassName?: string;
  children: ReactNode;
  /** Rendered after the grid (overlays such as the onboarding wizard). */
  overlays?: ReactNode;
  platform?: Platform;
};

export function AppShell({
  active,
  onNavigate,
  sidebarStatus,
  header,
  bottomPanel,
  contentClassName,
  children,
  overlays,
  platform = getPlatform()
}: AppShellProps) {
  const [width, setWidth] = useState(() => clampSidebarWidth(readNumber(WIDTH_KEY, SIDEBAR_WIDTH.default)));
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_KEY));
  const [resizing, setResizing] = useState(false);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      write(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  }, []);

  const style = collapsed ? undefined : ({ "--sidebar-current": `${width}px` } as CSSProperties);

  return (
    <div
      className={cx("o-app", collapsed && "o-app--collapsed", resizing && "o-app--resizing")}
      style={style}
      data-view={active}
      data-testid="app-shell"
    >
      {platform === "macos" ? null : <TitleBar />}
      <div className="o-app__sidebar">
        <Sidebar
          {...sidebarStatus}
          active={active}
          onNavigate={onNavigate}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
          width={width}
          onResize={setWidth}
          onResizingChange={setResizing}
          onResizeEnd={(value) => write(WIDTH_KEY, String(value))}
        />
      </div>
      <main className="o-app__main">
        <PageHeader {...header} />
        <div className={cx("o-app__content", contentClassName)} key={active}>
          {children}
        </div>
      </main>
      <BottomPanel {...bottomPanel} />
      {overlays}
    </div>
  );
}
