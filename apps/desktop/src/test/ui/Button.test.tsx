import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Plus } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton } from "../../ui";

describe("Button", () => {
  it("is busy and disabled while loading", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(<Button onClick={onClick} loading>Salvar</Button>);
    const button = screen.getByRole("button", { name: "Salvar" });
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();

    rerender(<Button onClick={onClick}>Salvar</Button>);
    expect(button).not.toHaveAttribute("aria-busy");
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("defaults to type=button and applies variant and size classes", () => {
    render(<Button variant="primary" size="lg">Ok</Button>);
    const button = screen.getByRole("button", { name: "Ok" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("o-button--primary", "o-button--lg");
  });

  it("IconButton uses its label as accessible name and tooltip", () => {
    render(<IconButton label="Adicionar" icon={<Plus />} />);
    const button = screen.getByRole("button", { name: "Adicionar" });
    expect(button).toHaveAttribute("title", "Adicionar");
  });
});
