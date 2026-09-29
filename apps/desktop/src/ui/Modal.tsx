import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { uiStrings } from "../strings/common";
import { cx } from "./cx";
import { getFocusable } from "./focus";
import { IconButton } from "./IconButton";
import "./Modal.css";

/** Open modals, bottom to top. Only the topmost one reacts to Esc and traps Tab. */
const modalStack: string[] = [];

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: "sm" | "md" | "lg";
  footer?: ReactNode;
  /** When false, Esc, the backdrop and the close button do nothing (e.g. while saving). */
  dismissible?: boolean;
  /** Element to focus on open; defaults to the first focusable element in the body. */
  initialFocus?: RefObject<HTMLElement | null>;
  children?: ReactNode;
  className?: string;
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  footer,
  dismissible = true,
  initialFocus,
  children,
  className
}: ModalProps) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const latest = useRef({ onClose, dismissible, initialFocus });
  latest.current = { onClose, dismissible, initialFocus };

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    modalStack.push(id);

    const dialog = dialogRef.current;
    const initial = latest.current.initialFocus?.current ?? getFocusable(bodyRef.current)[0] ?? getFocusable(dialog)[0] ?? dialog;
    initial?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (latest.current.dismissible) latest.current.onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = getFocusable(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = modalStack.lastIndexOf(id);
      if (index !== -1) modalStack.splice(index, 1);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [id, open]);

  if (!open || typeof document === "undefined") return null;

  const titleId = `${id}-title`;
  const descriptionId = description ? `${id}-description` : undefined;

  return createPortal(
    <div
      className="o-modal-layer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cx("o-modal", `o-modal--${size}`, className)}
      >
        <header className="o-modal__header">
          <div className="o-modal__heading">
            <h2 className="o-modal__title" id={titleId}>{title}</h2>
            {description ? <p className="o-modal__description" id={descriptionId}>{description}</p> : null}
          </div>
          {dismissible ? <IconButton label={uiStrings.close} icon={<X />} size="sm" onClick={onClose} /> : null}
        </header>
        {children != null ? <div className="o-modal__body" ref={bodyRef}>{children}</div> : null}
        {footer ? <footer className="o-modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body
  );
}
