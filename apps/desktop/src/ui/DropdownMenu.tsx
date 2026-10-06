import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode
} from "react";
import { Check } from "lucide-react";
import { createPortal } from "react-dom";
import { cx } from "./cx";
import "./DropdownMenu.css";

export type MenuItem = {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
  /** Small caption above the item that starts a group ("Leitura", "Nota"). */
  heading?: string;
  /** Checkmark state for choices inside a group (menuitemradio). */
  checked?: boolean;
  /** With `checked`: an independent on/off choice (menuitemcheckbox), not one of a group. */
  multiple?: boolean;
  /** Content after the label (e.g. stars), right-aligned. */
  trailing?: ReactNode;
  /** A second, quieter line under the label ("Indicar algo que você já tem"). */
  description?: string;
  /** Not an action: a caption row at the top (who is signed in), label over description. */
  info?: boolean;
};

export type MenuPoint = { x: number; y: number };

export type DropdownMenuProps = {
  items: ReadonlyArray<MenuItem>;
  /** Accessible name of the menu. */
  label?: string;
  /** Horizontal alignment relative to the trigger (anchor mode). */
  align?: "start" | "end";
  className?: string;
  /**
   * Anchor mode: the element that toggles the menu (usually a Button or
   * IconButton). It receives onClick, onKeyDown and the aria-* menu props.
   */
  trigger?: ReactElement<HTMLAttributes<HTMLElement>>;
  /**
   * Context-menu mode: controlled open state at viewport coordinates.
   * Use together with `useContextMenu()`.
   */
  open?: boolean;
  position?: MenuPoint | null;
  onClose?: () => void;
};

const GAP = 4;

export function DropdownMenu({ items, label, align = "start", className, trigger, open: controlledOpen, position, onClose }: DropdownMenuProps) {
  const menuId = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [internalOpen, setInternalOpen] = useState(false);
  const [coords, setCoords] = useState<MenuPoint | null>(null);
  const isContext = trigger === undefined;
  const open = isContext ? Boolean(controlledOpen && position) : internalOpen;

  const focusTrigger = useCallback(() => {
    const focusTarget = anchorRef.current?.querySelector<HTMLElement>("button, [tabindex]") ?? anchorRef.current;
    focusTarget?.focus();
  }, []);

  const close = useCallback((restoreFocus = true) => {
    if (isContext) onClose?.();
    else setInternalOpen(false);
    if (restoreFocus && !isContext) focusTrigger();
  }, [focusTrigger, isContext, onClose]);

  const enabledIndexes = items.map((item, index) => (item.disabled || item.info ? -1 : index)).filter((index) => index !== -1);

  const focusItem = (index: number | undefined) => {
    if (index === undefined) return;
    itemRefs.current[index]?.focus();
  };

  // Position the menu next to the trigger (anchor mode) or at the pointer (context mode), clamped to the viewport.
  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const menu = menuRef.current;
    const menuWidth = menu?.offsetWidth ?? 0;
    const menuHeight = menu?.offsetHeight ?? 0;
    let x = 0;
    let y = 0;
    if (isContext && position) {
      x = position.x;
      y = position.y;
    } else if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      x = align === "end" ? rect.right - menuWidth : rect.left;
      y = rect.bottom + GAP;
      if (y + menuHeight > window.innerHeight && rect.top - menuHeight - GAP > 0) y = rect.top - menuHeight - GAP;
    }
    x = Math.max(GAP, Math.min(x, window.innerWidth - menuWidth - GAP));
    y = Math.max(GAP, Math.min(y, window.innerHeight - menuHeight - GAP));
    setCoords({ x, y });
  }, [align, isContext, open, position]);

  // Focus the first item once the menu is placed (a hidden menu cannot take focus, so Esc and
  // the arrows would not reach it).
  const placed = coords !== null;
  useEffect(() => {
    if (open && placed) focusItem(enabledIndexes[0]);
  }, [open, placed]);

  // Close on outside pointer, window blur, resize or scroll.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      close(false);
    };
    const onDismiss = () => close(false);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    window.addEventListener("blur", onDismiss);
    window.addEventListener("resize", onDismiss);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      window.removeEventListener("blur", onDismiss);
      window.removeEventListener("resize", onDismiss);
    };
  }, [close, open]);

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = itemRefs.current.findIndex((node) => node === document.activeElement);
    const position = enabledIndexes.indexOf(current);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const next = position === -1 ? (delta === 1 ? 0 : enabledIndexes.length - 1) : (position + delta + enabledIndexes.length) % enabledIndexes.length;
      focusItem(enabledIndexes[next]);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusItem(enabledIndexes[0]);
    } else if (event.key === "End") {
      event.preventDefault();
      focusItem(enabledIndexes[enabledIndexes.length - 1]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  let anchor: ReactNode = null;
  if (!isContext && isValidElement(trigger)) {
    const triggerProps = trigger.props;
    anchor = (
      <span className="o-menu-anchor" ref={anchorRef}>
        {cloneElement(trigger, {
          "aria-haspopup": "menu",
          "aria-expanded": open,
          "aria-controls": open ? menuId : undefined,
          onClick: (event: ReactMouseEvent<HTMLElement>) => {
            triggerProps.onClick?.(event);
            setInternalOpen((value) => !value);
          },
          onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
            triggerProps.onKeyDown?.(event);
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setInternalOpen(true);
            }
          }
        } as HTMLAttributes<HTMLElement>)}
      </span>
    );
  }

  const menu = open && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        aria-orientation="vertical"
        className={cx("o-menu", className)}
        style={{ left: coords?.x ?? 0, top: coords?.y ?? 0, visibility: coords ? "visible" : "hidden" }}
        onKeyDown={onMenuKeyDown}
        onContextMenu={(event) => event.preventDefault()}
      >
        {items.map((item, index) => (
          item.info ? (
            <div key={`${item.label}-${index}`} role="presentation" className="o-menu__info">
              <span className="o-menu__info-label">{item.label}</span>
              {item.description ? <span className="o-menu__description">{item.description}</span> : null}
            </div>
          ) : (
          <div key={`${item.label}-${index}`} role="none" className={cx("o-menu__row", item.separatorBefore && "o-menu__row--separated")}>
            {item.heading ? <div role="presentation" className="o-menu__heading">{item.heading}</div> : null}
            <button
              ref={(node) => {
                itemRefs.current[index] = node;
              }}
              type="button"
              role={item.checked === undefined ? "menuitem" : item.multiple ? "menuitemcheckbox" : "menuitemradio"}
              aria-checked={item.checked === undefined ? undefined : item.checked}
              tabIndex={-1}
              disabled={item.disabled}
              aria-disabled={item.disabled || undefined}
              className={cx("o-menu__item", item.danger && "o-menu__item--danger")}
              onClick={() => select(item)}
            >
              {item.checked !== undefined ? (
                <span className={cx("o-menu__check", item.checked && "is-checked")} aria-hidden="true"><Check /></span>
              ) : null}
              {item.icon ? <span className="o-menu__icon" aria-hidden="true">{item.icon}</span> : null}
              {item.description ? (
                <span className="o-menu__text">
                  <span className="o-menu__label">{item.label}</span>
                  <span className="o-menu__description">{item.description}</span>
                </span>
              ) : (
                <span className="o-menu__label">{item.label}</span>
              )}
              {item.trailing ? <span className="o-menu__trailing" aria-hidden="true">{item.trailing}</span> : null}
            </button>
          </div>
          )
        ))}
      </div>,
      document.body
    )
    : null;

  return (
    <>
      {anchor}
      {menu}
    </>
  );
}

/** State helper for right-click menus: spread `onContextMenu` on the target and pass the rest to DropdownMenu. */
export function useContextMenu() {
  const [position, setPosition] = useState<MenuPoint | null>(null);
  const onContextMenu = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    setPosition({ x: event.clientX, y: event.clientY });
  }, []);
  const onClose = useCallback(() => setPosition(null), []);
  return { open: position !== null, position, onContextMenu, onClose };
}
