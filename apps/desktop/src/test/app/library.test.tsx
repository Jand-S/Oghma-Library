import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { commonStrings, navStrings } from "../../strings/common";
import { libraryStrings } from "../../strings/library";
import { getLibraryCard, renderReadyApp, resetAppState, setupUser, tabName } from "../renderApp";

describe("Library", () => {
  beforeEach(resetAppState);

  it("switches the local library queue to Kindle mode when connected", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: navStrings.library }));
    expect(screen.getByRole("heading", { name: commonStrings.filters })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: commonStrings.hideFilters }));
    expect(screen.queryByRole("heading", { name: commonStrings.filters })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: commonStrings.showFilters }));
    expect(screen.getByRole("heading", { name: commonStrings.filters })).toBeInTheDocument();
    expect(screen.queryByText(commonStrings.synopsis)).not.toBeInTheDocument();

    const { card, title } = getLibraryCard("To Kill a Mockingbird");
    expect(within(card).getByTestId("book-cover").style.backgroundImage).toContain("oghma-icon.svg");

    await user.click(title);
    const sidebar = screen.getByTestId("library-sidebar");
    expect(within(sidebar).getByText(commonStrings.synopsis)).toBeInTheDocument();
    expect(within(sidebar).getByTestId("detail-cover").style.backgroundImage).toContain("oghma-icon.svg");
    await user.click(screen.getByRole("tab", { name: tabName(commonStrings.queueTab) }));
    expect(screen.getByRole("heading", { name: libraryStrings.kindleQueueHeading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "EPUB" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "PDF" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "TXT" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "AZW3" })).toHaveAttribute("aria-pressed", "true");
    // Translation is not offered when sending to the Kindle.
    expect(screen.queryByRole("button", { name: /Traduzir/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: commonStrings.audiobook })).toBeDisabled();
    expect(screen.getByRole("button", { name: libraryStrings.sendToKindle })).toBeInTheDocument();
  });
});
