import { render, screen } from "@testing-library/react";
import { Search, X } from "lucide-react";
import { describe, expect, it } from "vitest";
import { SelectField, TextField } from "../../ui";

describe("fields", () => {
  it("renders one wrapper box around a bare native input", () => {
    render(<TextField label="Buscar" type="search" leading={<Search />} />);
    const input = screen.getByRole("searchbox", { name: "Buscar" });
    expect(input).toHaveClass("o-field__input");
    expect(input.parentElement).toHaveClass("o-field__control");
    expect(input.parentElement).not.toHaveClass("o-field__control--trailing");
  });

  it("marks fields with a custom trailing control so the native search cancel button is hidden", () => {
    render(<TextField label="Buscar" type="search" trailing={<button type="button" aria-label="Limpar"><X /></button>} />);
    expect(screen.getByRole("searchbox", { name: "Buscar" }).parentElement).toHaveClass("o-field__control--trailing");
  });

  it("flags invalid fields and wires the error text", () => {
    render(<TextField label="Pasta" error="Pasta não encontrada" />);
    const input = screen.getByRole("textbox", { name: "Pasta" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Pasta não encontrada");
    expect(input.closest(".o-field")).toHaveClass("o-field--invalid");
  });

  it("draws its own chevron next to a bare select", () => {
    const { container } = render(<SelectField label="Fonte" options={[{ value: "a", label: "Acervo Alfa" }]} />);
    const select = screen.getByRole("combobox", { name: "Fonte" });
    expect(select).toHaveClass("o-field__select");
    expect(container.querySelectorAll(".o-field__chevron")).toHaveLength(1);
  });
});
