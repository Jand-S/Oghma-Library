import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { describeActiveDownload, detectPlatform, formatEta, formatSpeed } from "../../shell";
import { BottomPanel } from "../../shell/BottomPanel";
import { navStrings, pageTitleStrings, shellStrings, windowControlStrings } from "../../strings/common";
import { renderApp, renderReadyApp, resetAppState, seedSetup, setupUser } from "../renderApp";

describe("App shell", () => {
  beforeEach(resetAppState);

  it("dispatches window control actions outside the Tauri runtime", async () => {
    const user = setupUser();
    const listener = vi.fn();
    window.addEventListener("oghma-window-action", listener);
    seedSetup();
    renderApp();

    expect(screen.getByTestId("app-shell")).toBeInTheDocument();
    expect(screen.getByTestId("titlebar")).toBeInTheDocument();

    await user.click(screen.getByLabelText(windowControlStrings.minimize));
    await user.click(screen.getByLabelText(windowControlStrings.maximize));
    await user.click(screen.getByLabelText(windowControlStrings.close));

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([event]) => (event as CustomEvent).detail)).toEqual(["minimize", "maximize", "close"]);
    window.removeEventListener("oghma-window-action", listener);
  });

  it("hides the custom title bar on macOS", () => {
    document.documentElement.dataset.platform = "macos";
    try {
      seedSetup();
      renderApp();
      expect(screen.queryByTestId("titlebar")).not.toBeInTheDocument();
      expect(screen.queryByLabelText(windowControlStrings.close)).not.toBeInTheDocument();
    } finally {
      delete document.documentElement.dataset.platform;
    }
  });

  it("lists every nav entry, including Kindle, and marks the active one", async () => {
    const user = setupUser();
    await renderReadyApp();

    for (const id of ["discover", "downloads", "library", "kindle", "translation", "sources", "settings"]) {
      expect(screen.getByTestId(`nav-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("nav-discover")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.discover })).toBeInTheDocument();

    await user.click(screen.getByTestId("nav-kindle"));
    expect(screen.getByTestId("nav-kindle")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: pageTitleStrings.kindle })).toBeInTheDocument();
  });

  it("collapses and expands the sidebar with the right labels and remembers it", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByRole("button", { name: shellStrings.collapseSidebar }));
    const expand = screen.getByRole("button", { name: shellStrings.expandSidebar });
    expect(expand).toHaveAttribute("aria-expanded", "false");
    expect(window.localStorage.getItem("oghma.sidebar.collapsed")).toBe("1");
    // Labels stay accessible in the icon rail.
    expect(screen.getByRole("button", { name: navStrings.library })).toBeInTheDocument();

    await user.click(expand);
    expect(screen.getByRole("button", { name: shellStrings.collapseSidebar })).toHaveAttribute("aria-expanded", "true");
  });

  it("resizes the sidebar from the keyboard and stores the width", async () => {
    const user = setupUser();
    await renderReadyApp();
    const handle = screen.getByRole("separator", { name: shellStrings.resizeSidebar });
    expect(handle).toHaveAttribute("aria-valuenow", "240");
    handle.focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "256");
    expect(window.localStorage.getItem("oghma.sidebar.width")).toBe("256");
    await user.keyboard("{End}");
    expect(handle).toHaveAttribute("aria-valuenow", "320");
  });

  it("opens Downloads from the bottom panel and offers a back button", async () => {
    const user = setupUser();
    await renderReadyApp();

    await user.click(screen.getByTitle(shellStrings.openDownloads));
    await waitFor(() => expect(screen.getByTestId("nav-downloads")).toHaveAttribute("aria-current", "page"));
    await user.click(screen.getByRole("button", { name: shellStrings.back }));
    expect(screen.getByTestId("nav-discover")).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: shellStrings.back })).not.toBeInTheDocument();
  });
});

describe("BottomPanel", () => {
  it("shows the idle line and the active download status", async () => {
    const onOpen = vi.fn();
    const { rerender } = render(<BottomPanel queuedCount={0} kindle={null} onOpenDownloads={onOpen} />);
    expect(screen.getByText(shellStrings.idle)).toBeInTheDocument();

    rerender(
      <BottomPanel
        active={{ title: "Livro", progress: 42, speedBps: 1_258_291, etaSec: 35 }}
        queuedCount={2}
        kindle={{ connected: true, deviceName: "Kindle" }}
        onOpenDownloads={onOpen}
      />
    );
    expect(screen.getByText("Baixando Livro… 42% · 1,2 MB/s · 0:35")).toBeInTheDocument();
    expect(screen.getByText(shellStrings.queued(2))).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    screen.getByRole("button").click();
    expect(onOpen).toHaveBeenCalled();
  });

  it("formats speed, ETA and the status line", () => {
    expect(formatSpeed(512)).toBe("512 B/s");
    expect(formatSpeed(1_258_291)).toBe("1,2 MB/s");
    expect(formatEta(35)).toBe("0:35");
    expect(formatEta(3723)).toBe("1:02:03");
    expect(describeActiveDownload({ title: "X", progress: 10.4 })).toBe("Baixando X… 10%");
  });

  it("detects the platform from the user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)")).toBe("macos");
    expect(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
    expect(detectPlatform("Mozilla/5.0 (X11; Linux x86_64)")).toBe("linux");
  });
});
