import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupStorageKey } from "../../core/appConfig";
import type { SourceSite } from "../../core/types";
import { formatRelativeSync } from "../../features/sources/lastSync";
import { SourceIcon } from "../../features/sources/SourceIcon";
import { sourceIconFor, sourceIconPath } from "../../features/sources/sourceIcons";
import { SourcesView } from "../../features/sources/SourcesView";
import { sourcesStrings } from "../../strings/sources";
import { renderReadyApp, resetAppState, setupUser } from "../renderApp";

describe("Sources", () => {
  beforeEach(resetAppState);
  afterEach(() => vi.restoreAllMocks());

  it("lists the sources in one table with icon, domain, count and a switch", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const rows = await screen.findAllByTestId("source-row");
    expect(rows).toHaveLength(3);
    expect(screen.getAllByRole("table")).toHaveLength(1);
    expect(screen.getByText(sourcesStrings.summary(3, 2))).toBeInTheDocument();

    const central = rows[0];
    expect(within(central).getByRole("rowheader")).toHaveTextContent("Central Novel");
    expect(within(central).getByText("centralnovel.com")).toBeInTheDocument();
    expect(within(central).getByText("1.248")).toBeInTheDocument();
    expect(within(central).getByText("PT-BR")).toBeInTheDocument();
    expect(within(central).getByRole("switch", { name: /Incluir na busca \(Central Novel\)/ })).toHaveAttribute("aria-checked", "true");
    expect(within(central).getByTestId("source-icon").querySelector("img")).toHaveAttribute("src", "/sources/central-novel.png");
    // Online sources show no status badge.
    expect(within(central).queryByTestId("source-status")).not.toBeInTheDocument();

    const local = rows[2];
    expect(local).toHaveAttribute("data-enabled", "false");
    expect(within(local).getByRole("switch")).toHaveAttribute("aria-checked", "false");
    // No bundled icon: monogram tile.
    expect(within(local).getByTestId("source-icon")).toHaveAttribute("data-fallback", "monogram");
    expect(within(local).getByTestId("source-icon")).toHaveTextContent("S");
  });

  it("enables a source with its switch and saves it", async () => {
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const local = (await screen.findAllByTestId("source-row"))[2];
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

    const central = (await screen.findAllByTestId("source-row"))[0];
    await user.click(within(central).getByRole("button", { name: sourcesStrings.syncSource("Central Novel") }));
    expect(await within(central).findByText("Agora")).toBeInTheDocument();
    expect(within(central).getByText("1.251")).toBeInTheDocument();
  });

  it("opens the source's site in the browser", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = setupUser();
    await renderReadyApp();
    await user.click(screen.getByTestId("nav-sources"));

    const central = (await screen.findAllByTestId("source-row"))[0];
    await user.click(within(central).getByRole("button", { name: sourcesStrings.openSiteOf("Central Novel") }));
    await waitFor(() => expect(open).toHaveBeenCalledWith("https://centralnovel.com/", "_blank", "noopener,noreferrer"));
  });
});

function makeSource(index: number, overrides: Partial<SourceSite> = {}): SourceSite {
  return {
    id: `site-${index}`,
    name: `Site ${index}`,
    baseUrl: `https://site${index}.example.com/`,
    count: 10 * index,
    status: "online",
    enabled: true,
    mode: "api_available",
    lastSync: "2026-09-01",
    delayMs: 0,
    ...overrides
  };
}

const noop = () => undefined;

describe("SourcesView", () => {
  it("shows a search field only past eight sources and filters by name or domain", async () => {
    const user = setupUser();
    const few = Array.from({ length: 8 }, (_, index) => makeSource(index));
    const { rerender } = render(<SourcesView sources={few} syncing={[]} onToggle={noop} onSync={noop} onOpenSettings={noop} />);
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    const many = [...few, makeSource(8, { id: "golden-novel", name: "Golden Novel", baseUrl: "https://goldennovel.com/" })];
    rerender(<SourcesView sources={many} syncing={[]} onToggle={noop} onSync={noop} onOpenSettings={noop} />);
    const search = screen.getByRole("searchbox", { name: sourcesStrings.search });
    await user.type(search, "golden");
    expect(screen.getAllByTestId("source-row")).toHaveLength(1);
    await user.clear(search);
    await user.type(search, "site3.example");
    expect(screen.getAllByTestId("source-row")).toHaveLength(1);
    await user.type(search, "zzz");
    expect(screen.queryByTestId("source-row")).not.toBeInTheDocument();
    expect(screen.getByText(sourcesStrings.noMatches("site3.examplezzz"))).toBeInTheDocument();
  });

  it("shows status badges only for syncing or offline sources", () => {
    render(
      <SourcesView
        sources={[makeSource(1), makeSource(2, { status: "offline" }), makeSource(3)]}
        syncing={["site-3"]}
        onToggle={noop}
        onSync={noop}
        onOpenSettings={noop}
      />
    );
    const badges = screen.getAllByTestId("source-status");
    expect(badges.map((badge) => badge.textContent)).toEqual([sourcesStrings.status.offline, sourcesStrings.status.syncing]);
  });

  it("renders skeleton rows while loading", () => {
    render(<SourcesView sources={[]} syncing={[]} loading onToggle={noop} onSync={noop} onOpenSettings={noop} />);
    expect(screen.getAllByTestId("source-skeleton").length).toBeGreaterThan(0);
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("shows the empty state without sources", async () => {
    const onOpenSettings = vi.fn();
    const user = setupUser();
    render(<SourcesView sources={[]} syncing={[]} onToggle={noop} onSync={noop} onOpenSettings={onOpenSettings} />);
    expect(screen.getByText(sourcesStrings.emptyTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: sourcesStrings.openSettings }));
    expect(onOpenSettings).toHaveBeenCalled();
  });
});

describe("source icons", () => {
  it("maps ids, underscore ids, domains and URLs to bundled icons", () => {
    expect(sourceIconPath("central-novel")).toBe("/sources/central-novel.png");
    expect(sourceIconPath("novel_mania")).toBe("/sources/novel-mania.png");
    expect(sourceIconPath("roliascan.com")).toBe("/sources/rolia-scan.png");
    expect(sourceIconPath("https://www.goldennovel.com/series/x")).toBe("/sources/golden-novel.png");
    expect(sourceIconPath("sky-demon-order")).toBeNull();
    expect(sourceIconFor({ id: "unknown", baseUrl: "https://mahoureader.com/" })).toBe("/sources/mahou-reader.png");
  });

  it("falls back to a monogram when the image fails to load", () => {
    render(<SourceIcon sourceId="house-saikai" name="House Saikai" />);
    const icon = screen.getByTestId("source-icon");
    const img = icon.querySelector("img");
    expect(img).toHaveAttribute("src", "/sources/house-saikai.png");
    fireEvent.error(img as HTMLImageElement);
    expect(icon).toHaveAttribute("data-fallback", "monogram");
    expect(icon).toHaveTextContent("H");
  });
});

describe("formatRelativeSync", () => {
  const now = new Date(2026, 8, 29, 15, 0);
  it("turns ISO dates into relative time", () => {
    expect(formatRelativeSync("2026-09-29", now).label).toBe("Hoje");
    expect(formatRelativeSync("2026-09-28", now).label).toBe("Ontem");
    expect(formatRelativeSync("2026-09-27", now)).toEqual({ label: "há 2 dias", title: "27/09/2026" });
    expect(formatRelativeSync("2026-07-15", now).label).toBe("há 2 meses");
    expect(formatRelativeSync(new Date(2026, 8, 29, 14, 20).toISOString(), now).label).toBe("há 40 min");
  });

  it("passes human text through", () => {
    expect(formatRelativeSync("Hoje, 01:14", now).label).toBe("Hoje, 01:14");
    expect(formatRelativeSync("", now).label).toBe("—");
  });
});
