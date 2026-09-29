import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DropdownMenu, type MenuItem } from "../../ui";

function items(onSelect = vi.fn()): MenuItem[] {
  return [
    { label: "Editar", onSelect: () => onSelect("edit") },
    { label: "Bloqueado", onSelect: () => onSelect("blocked"), disabled: true },
    { label: "Excluir", onSelect: () => onSelect("delete"), danger: true }
  ];
}

describe("DropdownMenu", () => {
  it("opens from the trigger, navigates with arrows skipping disabled items and selects", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DropdownMenu label="Ações" trigger={<button>Mais</button>} items={items(onSelect)} />);
    const trigger = screen.getByRole("button", { name: "Mais" });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);
    expect(screen.getByRole("menu", { name: "Ações" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();

    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Excluir" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "Editar" })).toHaveFocus();
    await user.keyboard("{ArrowUp}{Enter}");

    expect(onSelect).toHaveBeenCalledWith("delete");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes on Esc (restoring focus) and on outside click", async () => {
    const user = userEvent.setup();
    render(
      <>
        <DropdownMenu trigger={<button>Mais</button>} items={items()} />
        <p>Fora</p>
      </>
    );
    const trigger = screen.getByRole("button", { name: "Mais" });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await user.click(screen.getByText("Fora"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("works as a context menu at x/y", () => {
    const onClose = vi.fn();
    render(<DropdownMenu label="Contexto" items={items()} open position={{ x: 40, y: 60 }} onClose={onClose} />);
    const menu = screen.getByRole("menu", { name: "Contexto" });
    expect(menu.style.left).toBe("40px");
    expect(menu.style.top).toBe("60px");
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
