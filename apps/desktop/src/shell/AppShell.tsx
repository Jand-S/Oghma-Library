import { useCallback, useEffect, useState, type CSSProperties, type ReactNode, type UIEvent } from "react";
import type { AppView } from "../app/NavigationContext";
import { cx } from "../ui";
import { BottomPanel, type BottomPanelProps } from "./BottomPanel";
import { PageHeader, type PageHeaderProps } from "./PageHeader";
import { getPlatform, type Platform } from "./platform";
import { clampSidebarWidth, isSidebarShortcut, Sidebar, SIDEBAR_WIDTH, type SidebarStatus } from "./Sidebar";
import { TitleBar } from "./TitleBar";

const WIDTH_KEY = "oghma.sidebar.width";
const COLLAPSED_KEY = "oghma.sidebar.collapsed";

/** Content-area variants defined in styles/layout.css. */
export type ContentLayout = "scroll" | "fill";

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
  /** Content-area variant: the page scrolls as a whole, or the view fills it (see layout.css). */
  contentLayout?: ContentLayout;
  children: ReactNode;
  /** Rendered after the grid (overlays such as the onboarding wizard). */
  overlays?: ReactNode;
  platform?: Platform;
  /** The reader's profile at the bottom of the sidebar (gets `collapsed`). */
  sidebarAccount?: (collapsed: boolean) => ReactNode;
};

export function AppShell({
  active,
  onNavigate,
  sidebarStatus,
  header,
  bottomPanel,
  contentLayout = "scroll",
  children,
  overlays,
  platform = getPlatform(),
  sidebarAccount
}: AppShellProps) {
  const [width, setWidth] = useState(() => clampSidebarWidth(readNumber(WIDTH_KEY, SIDEBAR_WIDTH.default)));
  const [collapsed, setCollapsed] = useState(() => readFlag(COLLAPSED_KEY));
  const [resizing, setResizing] = useState(false);
  // The header hairline only shows once the page has scrolled under it (macOS toolbar style).
  const [scrolledView, setScrolledView] = useState<AppView | null>(null);
  const onContentScroll = (event: UIEvent<HTMLDivElement>) => {
    const scrolled = event.currentTarget.scrollTop > 0;
    if (scrolled !== (scrolledView === active)) setScrolledView(scrolled ? active : null);
  };

  const toggleCollapsed = useCallback(() => {
    setCollapsed((value) => {
      write(COLLAPSED_KEY, value ? "0" : "1");
      return !value;
    });
  }, []);

  // ⌃⌘S (Ctrl+Shift+S): hide or show the sidebar from anywhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isSidebarShortcut(event)) return;
      event.preventDefault();
      toggleCollapsed();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleCollapsed]);

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
          account={sidebarAccount?.(collapsed)}
        />
      </div>
      <main className={cx("o-app__main", scrolledView === active && "o-app__main--scrolled")}>
        <PageHeader {...header} key={`header-${active}`} />
        <div className={cx("o-app__content", `o-app__content--${contentLayout}`)} key={`content-${active}`} data-layout={contentLayout} onScroll={contentLayout === "scroll" ? onContentScroll : undefined}>
          {children}
        </div>
      </main>
      <BottomPanel {...bottomPanel} />
      {overlays}
    </div>
  );
}
