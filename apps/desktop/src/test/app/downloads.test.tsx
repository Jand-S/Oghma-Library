import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { navStrings } from "../../strings/common";
import { downloadsStrings } from "../../strings/downloads";
import { renderReadyApp, resetAppState, setupUser } from "../renderApp";

describe("Downloads", () => {
  beforeEach(resetAppState);

  it("clears all completed downloads without requiring selection", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: navStrings.downloads }));
    const completed = screen.getByTestId("downloads-completed");
    expect(within(completed).getByText("Whispers of the Night")).toBeInTheDocument();
    expect(within(completed).getByText("The Labyrinth's Secret")).toBeInTheDocument();

    await user.click(within(completed).getByRole("button", { name: downloadsStrings.clearCompleted }));

    expect(screen.queryByText("Whispers of the Night")).not.toBeInTheDocument();
    expect(screen.queryByText("The Labyrinth's Secret")).not.toBeInTheDocument();
    expect(within(completed).queryAllByTestId("queue-item")).toHaveLength(0);
  });
});
