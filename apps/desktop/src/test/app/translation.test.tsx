import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { navStrings } from "../../strings/common";
import { translationStrings } from "../../strings/translation";
import { renderReadyApp, resetAppState, setupUser } from "../renderApp";

describe("Translation", () => {
  beforeEach(resetAppState);

  it("opens the translation workspace from the sidebar", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: navStrings.translation }));

    expect(screen.getByRole("heading", { name: translationStrings.projectsHeading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: translationStrings.sessionHeading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: translationStrings.glossaryHeading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translationStrings.addBatch })).toBeEnabled();
  });
});
