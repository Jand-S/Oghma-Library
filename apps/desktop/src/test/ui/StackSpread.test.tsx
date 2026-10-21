import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StackSpread } from "../../ui";

type Book = { id: string; title: string };

const books = (count: number): Book[] => Array.from({ length: count }, (_, index) => ({ id: `b${index}`, title: `Livro ${index + 1}` }));

const anchors: HTMLElement[] = [];

function anchor() {
  const element = document.createElement("div");
  anchors.push(element);
  element.getBoundingClientRect = () => ({ left: 200, top: 120, width: 150, height: 225, right: 350, bottom: 345, x: 200, y: 120, toJSON: () => ({}) });
  document.body.append(element);
  return element;
}

function renderSpread(count: number, extra: Partial<Parameters<typeof StackSpread<Book>>[0]> = {}) {
  const onPick = vi.fn();
  const onClose = vi.fn();
  render(
    <StackSpread<Book>
      anchor={anchor()}
      title="Unsheathed"
      count={`${count} volumes`}
      items={books(count)}
      itemKey={(book) => book.id}
      card={(book) => ({ title: book.title, label: book.title })}
      onPick={onPick}
      onClose={onClose}
      data-testid="spread"
      {...extra}
    />
  );
  return { onPick, onClose, panel: screen.getByTestId("spread") };
}

describe("StackSpread", () => {
  beforeEach(() => {
    // A 1280×720 window (jsdom has no layout).
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1280 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 720 });
  });

  afterEach(() => {
    Reflect.deleteProperty(document.documentElement, "clientWidth");
    anchors.splice(0).forEach((element) => element.remove());
  });

  it("keeps a few editions on one row, without scrolling", () => {
    const { panel } = renderSpread(2);
    expect(panel.style.getPropertyValue("--stack-cols")).toBe("2");
    expect(panel).not.toHaveClass("is-scroll");
    expect(panel.style.height).toBe("");
  });

  it("wraps a long series into rows and scrolls its cards inside the window", () => {
    const { panel, onClose } = renderSpread(30);
    expect(panel.style.getPropertyValue("--stack-cols")).toBe("6");
    expect(panel).toHaveClass("is-scroll");
    // The window minus 16px on each side.
    expect(panel.style.height).toBe("688px");
    expect(screen.getAllByTestId("stack-spread-item")).toHaveLength(30);

    // Scrolling the cards keeps the spread open; scrolling the page behind folds it.
    fireEvent.scroll(panel.querySelector(".o-stack-spread__row")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.scroll(document);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("runs the heading action after folding, and focuses the first card, not the action", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { onClose, onPick } = renderSpread(3, { action: { label: "Enviar série ao Kindle", onSelect, hint: "Leva os 3 volumes" } });
    const action = screen.getByRole("button", { name: "Enviar série ao Kindle" });
    expect(action).toHaveAttribute("title", "Leva os 3 volumes");
    expect(document.activeElement).toBe(screen.getAllByTestId("stack-spread-item")[0]);

    await user.click(action);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });

  it("disables the heading action when there is nothing to do", () => {
    renderSpread(2, { action: { label: "Enviar série ao Kindle", onSelect: vi.fn(), disabled: true } });
    expect(screen.getByRole("button", { name: "Enviar série ao Kindle" })).toBeDisabled();
  });
});
