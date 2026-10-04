import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { AppView } from "../app/NavigationContext";
import { kindleStrings, shellStrings } from "../strings/common";
import { cx } from "../ui";
import { navGroups, settingsNavItem, type NavItem } from "./nav";
import "./Sidebar.css";

/** Mirrors --sidebar-w, --sidebar-w-min and --sidebar-w-max in tokens.css. */
export const SIDEBAR_WIDTH = { default: 240, min: 200, max: 320 } as const;
const KEYBOARD_STEP = 8;

export const clampSidebarWidth = (width: number) =>
  Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)));

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
  /** The reader's account at the bottom (avatar and nickname, or "Entrar"). */
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
    dragStart.current = { x: event.clientX, width };
    onResizingChange?.(true);
    let latest = width;
    const onMove = (moveEvent: PointerEvent) => {
      if (!dragStart.current) return;
      latest = clampSidebarWidth(dragStart.current.width + moveEvent.clientX - dragStart.current.x);
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
      <div className="o-sidebar__brand" data-tauri-drag-region>
        <img className="o-sidebar__logo" src="/icons/oghma-icon.svg" alt="" draggable={false} />
        <span className="o-sidebar__brand-name" data-tauri-drag-region>{shellStrings.appName}</span>
      </div>
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
        {account ? <div className="o-sidebar__account">{account}</div> : null}
        <ul role="list" className="o-sidebar__menu">
          {renderItem(settingsNavItem)}
        </ul>
        <button
          type="button"
          className="o-sidebar__item o-sidebar__toggle"
          aria-label={toggleLabel}
          aria-expanded={!collapsed}
          title={toggleLabel}
          onClick={onToggleCollapsed}
        >
          <span className="o-sidebar__icon" aria-hidden="true"><ToggleIcon /></span>
          <span className="o-sidebar__label" aria-hidden="true">{toggleLabel}</span>
        </button>
      </div>
      {collapsed ? null : (
        <div
          className="o-sidebar__handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={shellStrings.resizeSidebar}
          aria-valuemin={SIDEBAR_WIDTH.min}
          aria-valuemax={SIDEBAR_WIDTH.max}
          aria-valuenow={width}
          tabIndex={0}
          onPointerDown={onHandlePointerDown}
          onKeyDown={onHandleKeyDown}
          onDoubleClick={() => {
            onResize(SIDEBAR_WIDTH.default);
            onResizeEnd?.(SIDEBAR_WIDTH.default);
          }}
        />
      )}
    </aside>
  );
}
