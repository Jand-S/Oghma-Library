import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { setupStorageKey } from "../../core/appConfig";
import { sourcesStrings } from "../../strings/sources";
import { renderReadyApp, resetAppState, setupUser } from "../renderApp";

describe("Sources", () => {
  beforeEach(resetAppState);

  it("lists the sources as cards with a switch and a status badge", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const cards = await screen.findAllByTestId("source-card");
    expect(cards).toHaveLength(3);
    expect(screen.getByText(sourcesStrings.summary(3, 2))).toBeInTheDocument();

    const central = cards[0];
    expect(within(central).getByRole("heading", { name: "Central Novel" })).toBeInTheDocument();
    expect(within(central).getByText("centralnovel.com")).toBeInTheDocument();
    expect(within(central).getByText("1.248")).toBeInTheDocument();
    expect(within(central).getByRole("switch")).toHaveAttribute("aria-checked", "true");

    const local = cards[2];
    expect(within(local).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    expect(within(local).getByTestId("source-status")).toHaveTextContent(sourcesStrings.disabled);
  });

  it("enables a source with its switch and saves it", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const local = (await screen.findAllByTestId("source-card"))[2];
    await user.click(within(local).getByRole("switch"));
    expect(within(local).getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await waitFor(() => {
      expect(JSON.parse(window.localStorage.getItem(setupStorageKey) ?? "{}").enabledSourceIds).toContain("local");
    });
  });

  it("syncs a single source", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const central = (await screen.findAllByTestId("source-card"))[0];
    await user.click(within(central).getByRole("button", { name: sourcesStrings.syncSource("Central Novel") }));
    expect(await within(central).findByText("Agora")).toBeInTheDocument();
    expect(within(central).getByText("1.251")).toBeInTheDocument();
  });
});
