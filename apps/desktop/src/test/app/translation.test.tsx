import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { navStrings } from "../../strings/common";
import { translationStrings } from "../../strings/translation";
import { renderReadyApp, resetAppState, setupUser, type TestUser } from "../renderApp";

async function openTranslation(user: TestUser) {
  await user.click(screen.getByRole("button", { name: navStrings.translation }));
  await screen.findByRole("heading", { name: translationStrings.projectsHeading });
}

function workspaceTab(name: string) {
  return within(screen.getByRole("radiogroup", { name: translationStrings.workspaceTabs })).getByRole("radio", { name });
}

describe("Translation", () => {
  beforeEach(resetAppState);

  it("opens the translation workspace from the sidebar", async () => {
    const user = setupUser();
    await renderReadyApp();

    await openTranslation(user);

    expect(screen.getByRole("heading", { name: translationStrings.projectsHeading })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: translationStrings.sessionHeading })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: translationStrings.addBatch })).toBeEnabled();
    // Glossary moved to its own tab of the project workspace.
    await user.click(workspaceTab(translationStrings.tabGlossary));
    expect(screen.getByRole("heading", { name: translationStrings.glossaryHeading })).toBeInTheDocument();
  });

  it("flags the feature as a beta preview", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openTranslation(user);

    const banner = screen.getByTestId("translation-preview-banner");
    expect(banner).toHaveTextContent(translationStrings.previewBanner);
    expect(within(banner).getByText(translationStrings.beta)).toBeInTheDocument();
  });

  it("lists library books as projects and selects the first one", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openTranslation(user);

    const projects = screen.getAllByTestId("translation-project");
    expect(projects.length).toBeGreaterThan(0);
    expect(projects[0]).toHaveAttribute("aria-pressed", "true");
    expect(projects[0]).toHaveTextContent(translationStrings.statusIdle);

    if (projects.length > 1) {
      await user.click(projects[1]);
      expect(projects[1]).toHaveAttribute("aria-pressed", "true");
      expect(projects[0]).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("adds a batch and starts the translation with one primary action", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openTranslation(user);

    expect(screen.getByRole("heading", { name: translationStrings.emptyBatchesTitle })).toBeInTheDocument();
    const start = screen.getByRole("button", { name: translationStrings.startTranslation });
    expect(start).toBeDisabled();

    await user.click(screen.getByRole("button", { name: translationStrings.addBatch }));
    expect(await screen.findAllByTestId("translation-batch")).toHaveLength(1);
    expect(within(screen.getAllByTestId("translation-project")[0]).getByText(translationStrings.statusReady(1))).toBeInTheDocument();

    await user.click(start);
    await waitFor(() => expect(screen.getByTestId("translation-batch")).toHaveAttribute("data-status", "translating"));
    expect(start).toBeDisabled();
  });

  it("shows an empty glossary and adds a manual term", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openTranslation(user);
    await user.click(workspaceTab(translationStrings.tabGlossary));

    expect(screen.getByRole("heading", { name: translationStrings.emptyGlossaryTitle })).toBeInTheDocument();
    const add = screen.getByRole("button", { name: translationStrings.addTerm });
    expect(add).toBeDisabled();

    await user.type(screen.getByLabelText(translationStrings.termSource), "Gu Master");
    await user.type(screen.getByLabelText(translationStrings.termTarget), "Mestre Gu");
    await user.click(add);

    const terms = await screen.findAllByTestId("translation-term");
    expect(terms[0]).toHaveTextContent("Gu Master");
    expect(screen.queryByRole("heading", { name: translationStrings.emptyGlossaryTitle })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: translationStrings.removeTerm("Gu Master") }));
    expect(screen.queryAllByTestId("translation-term")).toHaveLength(0);
  });

  it("groups settings in the configuration tab with a cost summary", async () => {
    const user = setupUser();
    await renderReadyApp();
    await openTranslation(user);
    await user.click(workspaceTab(translationStrings.tabConfig));

    expect(screen.getByRole("heading", { name: translationStrings.summaryHeading })).toBeInTheDocument();
    expect(screen.getByTestId("translation-estimate")).toBeInTheDocument();

    const grader = screen.getByRole("switch", { name: translationStrings.allowGrader });
    expect(grader).toBeDisabled();
    await user.click(screen.getByRole("switch", { name: translationStrings.allowPaid }));
    expect(grader).toBeEnabled();

    await user.click(within(screen.getByRole("radiogroup", { name: translationStrings.scopeLabel })).getByRole("radio", { name: translationStrings.scopeRange }));
    expect(screen.getByLabelText(translationStrings.rangeStart)).toBeInTheDocument();
    expect(screen.getByLabelText(translationStrings.rangeEnd)).toBeInTheDocument();
  });
});
