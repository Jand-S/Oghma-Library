import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "../../ui";

describe("ProgressBar", () => {
  it("exposes progressbar semantics with clamped values", () => {
    const { rerender } = render(<ProgressBar label="Baixando" value={42} valueText="42% · 1,2 MB/s" />);
    const bar = screen.getByRole("progressbar", { name: "Baixando" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "42");
    expect(bar).toHaveAttribute("aria-valuetext", "42% · 1,2 MB/s");

    rerender(<ProgressBar label="Baixando" value={250} max={200} />);
    expect(bar).toHaveAttribute("aria-valuenow", "200");
    expect(bar).toHaveAttribute("aria-valuemax", "200");
  });

  it("omits aria-valuenow when indeterminate", () => {
    render(<ProgressBar label="Preparando" indeterminate />);
    const bar = screen.getByRole("progressbar", { name: "Preparando" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-busy", "true");
  });
});
