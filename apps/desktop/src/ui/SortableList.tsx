import { GripVertical } from "lucide-react";
import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from "react";
import { uiStrings } from "../strings/common";
import { cx } from "./cx";
import "./SortableList.css";

export type SortableHandleProps = {
  "aria-label": string;
  className: string;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
};

export type SortableRenderState = {
  index: number;
  dragging: boolean;
  /** Spread on the element used as drag handle, or render `<SortableList.Handle {...handleProps} />`. */
  handleProps: SortableHandleProps;
};

export type SortableListProps<T> = {
  items: ReadonlyArray<T>;
  getId: (item: T) => string;
  onReorder: (next: T[]) => void;
  renderItem: (item: T, state: SortableRenderState) => ReactNode;
  /** Human name of an item, used by the drag handle label and the live announcement. */
  getLabel?: (item: T) => string;
  /** Accessible name of the list. */
  "aria-label": string;
  className?: string;
  disabled?: boolean;
};

export function moveItem<T>(list: ReadonlyArray<T>, from: number, to: number): T[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

type DragState = { id: string; from: number; target: number };

/**
 * Reorderable list: drag an item by its handle with the pointer, or focus an
 * item and press Alt+ArrowUp / Alt+ArrowDown. Moves are announced in an
 * aria-live region.
 */
export function SortableList<T>({
  items,
  getId,
  onReorder,
  renderItem,
  getLabel = getId,
  className,
  disabled = false,
  "aria-label": ariaLabel
}: SortableListProps<T>) {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const pendingFocus = useRef<string | null>(null);

  // Keep keyboard focus on an item after it moved (React moves the DOM node, which can drop focus).
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (!id) return;
    pendingFocus.current = null;
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-sortable-id]") ?? []);
    nodes.find((node) => node.dataset.sortableId === id)?.focus();
  }, [items]);

  const commit = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || to >= items.length) return;
    const next = moveItem(items, from, to);
    onReorder(next);
    setAnnouncement(uiStrings.moved(getLabel(items[from]), to + 1, items.length));
  };

  const onItemKeyDown = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (disabled || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    const to = event.key === "ArrowUp" ? index - 1 : index + 1;
    if (to < 0 || to >= items.length) return;
    pendingFocus.current = getId(items[index]);
    commit(index, to);
  };

  const targetIndexAt = (clientY: number, draggedId: string) => {
    const nodes = Array.from(listRef.current?.querySelectorAll<HTMLElement>(":scope > [data-sortable-id]") ?? []);
    const others = nodes.filter((node) => node.dataset.sortableId !== draggedId);
    const index = others.findIndex((node) => {
      const rect = node.getBoundingClientRect();
      return clientY < rect.top + rect.height / 2;
    });
    return index === -1 ? others.length : index;
  };

  const startDrag = (event: ReactPointerEvent<HTMLElement>, item: T, index: number) => {
    if (disabled || event.button !== 0) return;
    event.preventDefault();
    const id = getId(item);
    setDrag({ id, from: index, target: index });

    const onMove = (moveEvent: PointerEvent) => {
      const target = targetIndexAt(moveEvent.clientY, id);
      setDrag((current) => (current && current.target !== target ? { ...current, target } : current));
    };
    const onUp = (upEvent: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      const target = targetIndexAt(upEvent.clientY, id);
      setDrag(null);
      commit(index, target);
    };
    const onCancel = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  // Where the drop indicator sits, in terms of the rendered (unchanged) order.
  const indicatorBefore = drag ? (drag.target >= drag.from ? drag.target + 1 : drag.target) : -1;

  return (
    <>
      <ul ref={listRef} role="list" aria-label={ariaLabel} className={cx("o-sortable", drag && "is-dragging", className)}>
        {items.map((item, index) => {
          const id = getId(item);
          const dragging = drag?.id === id;
          const label = getLabel(item);
          return (
            <li
              key={id}
              data-sortable-id={id}
              tabIndex={disabled ? undefined : 0}
              aria-roledescription="item reordenável"
              aria-label={label}
              className={cx(
                "o-sortable__item",
                dragging && "is-dragged",
                drag && !dragging && indicatorBefore === index && "o-sortable__item--drop-before",
                drag && !dragging && indicatorBefore === items.length && index === items.length - 1 && "o-sortable__item--drop-after"
              )}
              onKeyDown={(event) => onItemKeyDown(event, index)}
            >
              {renderItem(item, {
                index,
                dragging,
                handleProps: {
                  "aria-label": uiStrings.dragHandle(label),
                  className: "o-sortable__handle",
                  onPointerDown: (event) => startDrag(event, item, index)
                }
              })}
            </li>
          );
        })}
      </ul>
      <span className="sr-only" aria-live="polite" role="status">{announcement}</span>
    </>
  );
}

/** Default grip icon for a drag handle. */
function Handle(props: SortableHandleProps & { className?: string }) {
  return (
    <span {...props} role="img" className={cx("o-sortable__handle", props.className)}>
      <GripVertical aria-hidden="true" />
    </span>
  );
}

SortableList.Handle = Handle;
