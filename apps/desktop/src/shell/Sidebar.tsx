import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { AppView } from "../app/NavigationContext";
import { kindleStrings, shellStrings } from "../strings/common";
import { cx } from "../ui";
import { getPlatform } from "./platform";
import { navGroups, settingsNavItem, type NavItem } from "./nav";
import "./Sidebar.css";

/** Mirrors --sidebar-w, --sidebar-w-min and --sidebar-w-max in tokens.css. */
export const SIDEBAR_WIDTH = { default: 240, min: 200, max: 320 } as const;
const KEYBOARD_STEP = 8;
/** Dragging the edge this far past the minimum width hides the sidebar, like the Finder. */
const COLLAPSE_PAST_MIN = 56;
/** Dragging the edge of the hidden sidebar this far to the right brings it back. */
const EXPAND_AFTER = 40;

export const clampSidebarWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

/** ⌃⌘S on the Mac (as in Music and the Finder), Ctrl+Shift+S elsewhere. */
export const sidebarShortcut = () => (getPlatform() === "macos" ? "⌃⌘S" : "Ctrl+Shift+S");

/** The keyboard shortcut that hides and shows the sidebar. */
export const isSidebarShortcut = (event: { key: string; altKey: boolean; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) =>
  event.key.toLowerCase() === "s" && !event.altKey &&
  (getPlatform() === "macos" ? event.metaKey && event.ctrlKey && !event.shiftKey : event.ctrlKey && event.shiftKey && !event.metaKey);

export type SidebarStatus = {
  /** A download is running or queued: lights the Downloads entry. */
  downloading?: boolean;
  /** Bump to flash the Downloads entry (e.g. after adding to the queue). */
  flashKey?: number;
  kindleConnected?: boolean;
};

export type SidebarProps = SidebarStatus & {
  active: AppView;
  onNavigate: (view: AppView) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onResize: (width: number) => void;
  onResizingChange?: (resizing: boolean) => void;
  onResizeEnd?: (width: number) => void;
  /**
   * The reader's profile at the bottom (photo, Amigos, Ajustes). Without it (no account
   * support, tests) the footer keeps a plain "Ajustes" entry.
   */
  account?: ReactNode;
};

export function Sidebar({
  active,
  onNavigate,
  collapsed,
  onToggleCollapsed,
  width,
  onResize,
  onResizingChange,
  onResizeEnd,
  downloading = false,
  flashKey = 0,
  kindleConnected = false,
  account
}: SidebarProps) {
  const [flashing, setFlashing] = useState(false);
  const dragStart = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 700);
    return () => window.clearTimeout(timer);
  }, [flashKey]);

  const onHandlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    if (collapsed) {
      // The icon rail: pulling its edge to the right shows the sidebar again.
      const startX = event.clientX;
      const onRailMove = (moveEvent: PointerEvent) => {
        if (moveEvent.clientX - startX < EXPAND_AFTER) return;
        onRailUp();
        onToggleCollapsed();
      };
      const onRailUp = () => {
        window.removeEventListener("pointermove", onRailMove);
        window.removeEventListener("pointerup", onRailUp);
        window.removeEventListener("pointercancel", onRailUp);
      };
      window.addEventListener("pointermove", onRailMove);
      window.addEventListener("pointerup", onRailUp);
      window.addEventListener("pointercancel", onRailUp);
      return;
    }
    dragStart.current = { x: event.clientX, width };
    onResizingChange?.(true);
    let latest = width;
    const onMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return;
      const wanted = dragStart.current.width + moveEvent.clientX - dragStart.current.x;
      if (wanted < SIDEBAR_WIDTH.min - COLLAPSE_PAST_MIN) {
        // Hide it, and keep the last real width for when it comes back.
        latest = dragStart.current.width;
        onResize(latest);
        onUp();
        onToggleCollapsed();
        return;
      }
      latest = clampSidebarWidth(wanted);
      onResize(latest);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      dragStart.current = null;
      onResizingChange?.(false);
      onResizeEnd?.(latest);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  const onHandleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (collapsed) {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        onToggleCollapsed();
      }
      return;
    }
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = width - KEYBOARD_STEP;
    if (event.key === "ArrowRight") next = width + KEYBOARD_STEP;
    if (event.key === "Home") next = SIDEBAR_WIDTH.min;
    if (event.key === "End") next = SIDEBAR_WIDTH.max;
    if (next === null) return;
    event.preventDefault();
    const clamped = clampSidebarWidth(next);
    onResize(clamped);
    onResizeEnd?.(clamped);
  };

  const renderItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = active === item.id;
    const isDownloads = item.id === "downloads";
    const isKindle = item.id === "kindle";
    return (
      <li key={item.id}>
        <button
          type="button"
          className={cx(
            "o-sidebar__item",
            isActive && "is-active",
            isDownloads && downloading && "is-downloading",
            isDownloads && flashing && "is-flashing"
          )}
          data-nav={item.id}
          data-testid={`nav-${item.id}`}
          aria-current={isActive ? "page" : undefined}
          title={collapsed ? item.label : undefined}
          onClick={() => onNavigate(item.id)}
        >
          <span className="o-sidebar__icon" data-nav-icon aria-hidden="true">
            <Icon />
          </span>
          <span className="o-sidebar__label">{item.label}</span>
          {isDownloads && downloading ? (
            <span className="o-sidebar__indicator o-sidebar__indicator--activity" aria-hidden="true" />
          ) : null}
          {isKindle ? (
            <>
              <span
                className={cx("o-sidebar__indicator", kindleConnected ? "o-sidebar__indicator--online" : "o-sidebar__indicator--offline")}
                aria-hidden="true"
              />
              <span className="sr-only">({kindleConnected ? kindleStrings.shortConnected : kindleStrings.shortDisconnected})</span>
            </>
          ) : null}
        </button>
      </li>
    );
  };

  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const toggleLabel = collapsed ? shellStrings.expandSidebar : shellStrings.collapseSidebar;

  return (
    <aside className={cx("o-sidebar", collapsed && "o-sidebar--collapsed")} data-testid="sidebar">
      <div className="o-sidebar__drag" data-tauri-drag-region aria-hidden="true" />
      {/* The app name hides and shows the sidebar (the toggle icon appears on hover). */}
      <button
        type="button"
        className="o-sidebar__brand"
        aria-label={toggleLabel}
        aria-expanded={!collapsed}
        title={`${toggleLabel} (${sidebarShortcut()})`}
        onClick={onToggleCollapsed}
        data-testid="sidebar-toggle"
      >
        <img className="o-sidebar__logo" src="/icons/oghma-icon.svg" alt="" draggable={false} />
        <span className="o-sidebar__brand-name">{shellStrings.appName}</span>
        <span className="o-sidebar__brand-toggle" aria-hidden="true"><ToggleIcon /></span>
      </button>
      <nav className="o-sidebar__nav" aria-label={shellStrings.mainNav}>
        {navGroups.map((group) => (
          <div key={group.id} className="o-sidebar__group">
            {group.label ? <h2 className="o-sidebar__group-label" id={`nav-group-${group.id}`}>{group.label}</h2> : null}
            <ul role="list" className="o-sidebar__menu" aria-labelledby={group.label ? `nav-group-${group.id}` : undefined}>
              {group.items.map(renderItem)}
            </ul>
          </div>
        ))}
      </nav>
      <div className="o-sidebar__footer">
        {account ?? (
          <ul role="list" className="o-sidebar__menu">
            {renderItem(settingsNavItem)}
          </ul>
        )}
      </div>
      <div
        className="o-sidebar__handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={collapsed ? shellStrings.expandSidebar : shellStrings.resizeSidebar}
        title={collapsed ? shellStrings.expandSidebarHint : shellStrings.resizeSidebarHint(sidebarShortcut())}
        aria-valuemin={SIDEBAR_WIDTH.min}
        aria-valuemax={SIDEBAR_WIDTH.max}
        aria-valuenow={width}
        tabIndex={0}
        onPointerDown={onHandlePointerDown}
        onKeyDown={onHandleKeyDown}
        onDoubleClick={() => {
          if (collapsed) {
            onToggleCollapsed();
            return;
          }
          onResize(SIDEBAR_WIDTH.default);
          onResizeEnd?.(SIDEBAR_WIDTH.default);
        }}
      />
    </aside>
  );
}
