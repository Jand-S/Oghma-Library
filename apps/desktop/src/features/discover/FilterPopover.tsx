import { ChevronDown } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import { cx } from "../../ui";
import { getFocusable } from "../../ui/focus";

/** Gap between the trigger and the popover, and the minimum distance to the viewport edges. */
const GAP = 6;

type Coords = { left: number; top: number; maxHeight: number };

export type FilterPopoverProps = {
  /** Filter name shown on the trigger and used as the dialog's accessible name ("Status"). */
  label: string;
  /** Current value, shown inline and highlighted when the filter is active ("Em andamento", "3"). */
  value?: string;
  /** Text between the label and the value (": " → "Status: Em andamento", " · " → "Tags · 3"). */
  separator?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Popover content; `close` returns focus to the trigger. */
  children: (close: () => void) => ReactNode;
};

/**
 * Pill trigger plus an anchored, non-modal popover (portal, fixed position, clamped to the
 * viewport like DropdownMenu). Esc and outside clicks close it; Tab past either end closes it and
 * continues the page's tab order. Focus moves to `[data-autofocus]` (or the first control) on open.
 */
export function FilterPopover({ label, value, separator = ": ", size = "sm", className, children }: FilterPopoverProps) {
  const popoverId = useId();
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<Coords | null>(null);

  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const rect = anchor.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.max(GAP, Math.min(rect.left, window.innerWidth - width - GAP));
    const top = rect.bottom + GAP;
    setCoords({ left, top, maxHeight: Math.max(0, window.innerHeight - top - GAP * 2) });
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    place();
  }, [open, place]);

  // Follow the trigger on resize/scroll; close on outside pointer or Esc anywhere.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (popoverRef.current?.contains(target) || anchorRef.current?.contains(target))) return;
      close(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Keeps Discover's own Esc (close the preview) from firing too.
      event.preventDefault();
      close(popoverRef.current?.contains(document.activeElement) ?? false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("mousedown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("mousedown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [close, open, place]);

  // Move focus into the popover once it is placed.
  useEffect(() => {
    if (!open) return;
    const popover = popoverRef.current;
    const target = popover?.querySelector<HTMLElement>("[data-autofocus]") ?? getFocusable(popover)[0];
    target?.focus({ preventScroll: true });
  }, [open]);

  const onPopoverKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const focusable = getFocusable(popoverRef.current);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      close(true);
    } else if (!event.shiftKey && active === last) {
      // Continue after the trigger, as if the popover content sat right next to it.
      event.preventDefault();
      const order = getFocusable(document.body).filter((element) => !popoverRef.current?.contains(element));
      const next = order[order.indexOf(triggerRef.current as HTMLElement) + 1];
      close(false);
      (next ?? triggerRef.current)?.focus();
    }
  };

  const active = Boolean(value);
  const popover = open && typeof document !== "undefined"
    ? createPortal(
      <div
        ref={popoverRef}
        id={popoverId}
        role="dialog"
        aria-label={label}
        data-discover-popover=""
        className={cx("discover-popover", `discover-popover--${size}`, className)}
        style={{
          left: coords?.left ?? 0,
          top: coords?.top ?? 0,
          maxHeight: coords?.maxHeight,
          visibility: coords ? "visible" : "hidden"
        }}
        onKeyDown={onPopoverKeyDown}
      >
        {children(() => close(true))}
      </div>,
      document.body
    )
    : null;

  return (
    <div className="discover-filter" ref={anchorRef} data-testid="filter-field">
      <button
        ref={triggerRef}
        type="button"
        className={cx("discover-pill", active && "is-active", open && "is-open")}
        aria-label={value ? `${label}${separator}${value}` : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="discover-pill__label">{label}</span>
        {value ? (
          <>
            <span className="discover-pill__sep">{separator}</span>
            <span className="discover-pill__value">{value}</span>
          </>
        ) : null}
        <ChevronDown className="discover-pill__chevron" aria-hidden="true" />
      </button>
      {popover}
    </div>
  );
}
