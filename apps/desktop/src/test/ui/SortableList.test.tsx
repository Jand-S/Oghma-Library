import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { moveItem, SortableList } from "../../ui";

type Book = { id: string; title: string };

function Harness() {
  const [items, setItems] = useState<Book[]>([
    { id: "a", title: "Alfa" },
    { id: "b", title: "Beta" },
    { id: "c", title: "Gama" }
  ]);
  return (
    <SortableList
      aria-label="Fila"
      items={items}
      getId={(item) => item.id}
      getLabel={(item) => item.title}
      onReorder={setItems}
      renderItem={(item, { handleProps }) => (
        <div>
          <SortableList.Handle {...handleProps} />
          <span>{item.title}</span>
        </div>
      )}
    />
  );
}

const order = () => within(screen.getByRole("list", { name: "Fila" })).getAllByRole("listitem").map((item) => item.getAttribute("aria-label"));

describe("SortableList", () => {
  it("moves the focused item with Alt+ArrowUp/Down, keeps focus and announces", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const alfa = screen.getByRole("listitem", { name: "Alfa" });
    alfa.focus();

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(order()).toEqual(["Beta", "Alfa", "Gama"]);
    expect(screen.getByRole("listitem", { name: "Alfa" })).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Alfa movido para a posição 2 de 3.");

    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(order()).toEqual(["Beta", "Gama", "Alfa"]);

    // Already last: no-op.
    await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(order()).toEqual(["Beta", "Gama", "Alfa"]);

    await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
    expect(order()).toEqual(["Beta", "Alfa", "Gama"]);

    // Without Alt the arrows do nothing.
    await user.keyboard("{ArrowUp}");
    expect(order()).toEqual(["Beta", "Alfa", "Gama"]);
  });

  it("labels drag handles", () => {
    render(<Harness />);
    expect(screen.getByRole("img", { name: /Reordenar Beta/ })).toBeInTheDocument();
  });

  it("moveItem returns a reordered copy", () => {
    const list = [1, 2, 3, 4];
    expect(moveItem(list, 0, 2)).toEqual([2, 3, 1, 4]);
    expect(moveItem(list, 3, 0)).toEqual([4, 1, 2, 3]);
    expect(list).toEqual([1, 2, 3, 4]);
  });
});
