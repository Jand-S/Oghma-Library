import { useRef, type ReactNode } from "react";
import { uiStrings } from "../strings/common";
import { Button } from "./Button";
import { Modal } from "./Modal";

export type ConfirmationModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" styles the confirm button red and focuses Cancel first. */
  tone?: "default" | "danger";
  loading?: boolean;
  children?: ReactNode;
};

export function ConfirmationModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = uiStrings.confirm,
  cancelLabel = uiStrings.cancel,
  tone = "default",
  loading = false,
  children
}: ConfirmationModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      dismissible={!loading}
      initialFocus={tone === "danger" ? cancelRef : confirmRef}
      footer={(
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button ref={confirmRef} variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      )}
    >
      {children}
    </Modal>
  );
}
