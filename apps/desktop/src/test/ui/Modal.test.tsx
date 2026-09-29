import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { uiStrings } from "../../strings/common";
import { ConfirmationModal, Modal } from "../../ui";

function Harness({ onCloseOuter = () => undefined }: { onCloseOuter?: () => void }) {
  const [outer, setOuter] = useState(false);
  const [inner, setInner] = useState(false);
  return (
    <>
      <button onClick={() => setOuter(true)}>Abrir</button>
      <Modal open={outer} onClose={() => { onCloseOuter(); setOuter(false); }} title="Externo">
        <button>Primeiro</button>
        <button onClick={() => setInner(true)}>Abrir interno</button>
      </Modal>
      <Modal open={inner} onClose={() => setInner(false)} title="Interno">
        <button>Dentro</button>
      </Modal>
    </>
  );
}

describe("Modal", () => {
  it("renders an accessible dialog, focuses inside and restores focus on Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    await user.click(opener);

    const dialog = screen.getByRole("dialog", { name: "Externo" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Primeiro" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("closes only the topmost modal on Esc", async () => {
    const user = userEvent.setup();
    const onCloseOuter = vi.fn();
    render(<Harness onCloseOuter={onCloseOuter} />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    await user.click(screen.getByRole("button", { name: "Abrir interno" }));
    expect(screen.getByRole("dialog", { name: "Interno" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Interno" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Externo" })).toBeInTheDocument();
    expect(onCloseOuter).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Abrir interno" })).toHaveFocus();
  });

  it("traps Tab focus inside the dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Abrir" }));
    const dialog = screen.getByRole("dialog", { name: "Externo" });
    for (let index = 0; index < 5; index += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("ignores Esc and hides the close button when not dismissible", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Modal open onClose={onClose} title="Salvando" dismissible={false}><p>…</p></Modal>);
    await user.keyboard("{Escape}");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: uiStrings.close })).not.toBeInTheDocument();
  });

  it("ConfirmationModal focuses Cancel first for danger and confirms", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmationModal open onClose={() => undefined} onConfirm={onConfirm} title="Excluir?" confirmLabel="Excluir" tone="danger" />);
    expect(screen.getByRole("button", { name: uiStrings.cancel })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
