import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KindleDeviceStatus } from "../../core/types";
import type { BackendClient } from "../../services/backendClient";
import { mockBackendClient } from "../../services/mockBackend";
import { navStrings } from "../../strings/common";
import { kindlePageStrings } from "../../strings/kindle";
import { libraryStrings } from "../../strings/library";
import { settingsStrings } from "../../strings/settings";
import { integrationPreferencesKey } from "../../features/settings/preferences";
import { getLibraryCard, getToastRegion, renderReadyApp, resetAppState, setupUser, type TestUser } from "../renderApp";

const local = vi.hoisted(() => ({
  getICloudStatus: vi.fn(),
  saveItemsToICloud: vi.fn(),
  revealInICloud: vi.fn(),
  sendItemsToKindleWireless: vi.fn()
}));
const opener = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("../../services/localFiles", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../services/localFiles")>()),
  ...local
}));
vi.mock("../../features/settings/appInfo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../features/settings/appInfo")>()),
  ...opener
}));

const LOST_TEMPLE = "Mystery of the Lost Temple";

/** A Mac with the Kindle unplugged; Send to Kindle installed unless told otherwise. */
function macBackend(status: Partial<KindleDeviceStatus> = {}): BackendClient {
  return {
    ...mockBackendClient,
    async getKindleStatus() {
      const base = await mockBackendClient.getKindleStatus();
      return { ...base, connected: false, transport: "none", wirelessSupported: true, wirelessAvailable: true, ...status };
    }
  };
}

async function openDetails(user: TestUser, title: string) {
  await user.click(screen.getByRole("button", { name: navStrings.library }));
  await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
  await user.click(getLibraryCard(title).title);
  return screen.getByTestId("library-detail");
}

describe("Mac integrations", () => {
  beforeEach(() => {
    resetAppState();
    vi.clearAllMocks();
    local.getICloudStatus.mockResolvedValue({ available: true, root: "/icloud" });
    local.saveItemsToICloud.mockResolvedValue({ savedIds: ["x"], paths: ["/icloud/Livros/Mystery.epub"], folderPath: "/icloud/Livros" });
    local.revealInICloud.mockResolvedValue(true);
    local.sendItemsToKindleWireless.mockImplementation(async (items: unknown[]) => ({ openedIds: items.map((_, i) => String(i)) }));
    opener.openExternal.mockResolvedValue(undefined);
  });

  it("sends a book over Wi-Fi from the details menu and keeps the cable option disabled while unplugged", async () => {
    const user = setupUser();
    await renderReadyApp(macBackend());
    const details = await openDetails(user, LOST_TEMPLE);

    await user.click(within(details).getByTestId("library-kindle-menu"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: libraryStrings.kindleUsbDisconnected })).toBeDisabled();
    await user.click(within(menu).getByRole("menuitem", { name: libraryStrings.kindleViaWifi }));

    await waitFor(() => expect(local.sendItemsToKindleWireless).toHaveBeenCalledTimes(1));
    expect(local.sendItemsToKindleWireless.mock.calls[0][0].map((item: { title: string }) => item.title)).toEqual([LOST_TEMPLE]);
    expect(await within(getToastRegion()).findByText(libraryStrings.kindleWirelessOpened(1))).toBeInTheDocument();
  });

  it("offers to install Send to Kindle when the app is missing", async () => {
    const user = setupUser();
    await renderReadyApp(macBackend({ wirelessAvailable: false }));
    const details = await openDetails(user, LOST_TEMPLE);

    await user.click(within(details).getByTestId("library-kindle-menu"));
    await user.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: libraryStrings.installSendToKindle }));
    expect(local.sendItemsToKindleWireless).not.toHaveBeenCalled();
    const toast = await within(getToastRegion()).findByText(libraryStrings.sendToKindleMissing);
    await user.click(within(toast.closest(".o-toast") as HTMLElement).getByRole("button", { name: libraryStrings.installSendToKindle }));
    expect(opener.openExternal).toHaveBeenCalledWith("https://www.amazon.com/sendtokindle/mac");
  });

  it("saves to iCloud Drive in the configured folder and reveals it in Finder", async () => {
    window.localStorage.setItem(integrationPreferencesKey, JSON.stringify({ kindleMethod: "usb", icloudFolder: "Livros/Novels" }));
    const user = setupUser();
    await renderReadyApp(macBackend());
    const details = await openDetails(user, LOST_TEMPLE);

    await user.click(await within(details).findByTestId("library-icloud"));
    await waitFor(() => expect(local.saveItemsToICloud).toHaveBeenCalledTimes(1));
    expect(local.saveItemsToICloud.mock.calls[0][1]).toBe("Livros/Novels");
    const toast = await within(getToastRegion()).findByText(libraryStrings.icloudSaved(1, "Livros/Novels"));
    await user.click(within(toast.closest(".o-toast") as HTMLElement).getByRole("button", { name: libraryStrings.showInFinder }));
    expect(local.revealInICloud).toHaveBeenCalledWith("/icloud/Livros/Mystery.epub");
  });

  it("lists the Kindle and iCloud actions in the card context menu", async () => {
    const user = setupUser();
    await renderReadyApp(macBackend({ connected: true, transport: "mtp" }));
    await user.click(screen.getByRole("button", { name: navStrings.library }));
    await waitFor(() => expect(screen.getAllByTestId("library-card").length).toBeGreaterThan(0));
    await waitFor(() => expect(local.getICloudStatus).toHaveBeenCalled());

    fireEvent.contextMenu(getLibraryCard(LOST_TEMPLE).card, { clientX: 40, clientY: 40 });
    const menu = screen.getByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: libraryStrings.kindleViaWifiMenu })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: libraryStrings.kindleViaUsbMenu })).toBeEnabled();
    expect(within(menu).getByRole("menuitem", { name: libraryStrings.saveToICloud })).toBeEnabled();
  });

  it("sends from the Kindle page over Wi-Fi when the cable is unplugged", async () => {
    const user = setupUser();
    await renderReadyApp(macBackend());
    await user.click(screen.getByTestId("nav-kindle"));

    expect(await screen.findByTestId("kindle-wireless-status")).toHaveTextContent(kindlePageStrings.wirelessInstalled);
    expect(screen.getByRole("radio", { name: kindlePageStrings.methodUsb })).toBeDisabled();
    expect(screen.getByRole("radio", { name: kindlePageStrings.methodWireless })).toBeChecked();
    expect(screen.getByText(kindlePageStrings.wirelessHint)).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: kindlePageStrings.selectBook(LOST_TEMPLE) }));
    await user.click(screen.getByTestId("kindle-send"));
    await waitFor(() => expect(local.sendItemsToKindleWireless).toHaveBeenCalledTimes(1));
  });

  it("shows Send to Kindle, the default method and the iCloud folder in Ajustes", async () => {
    const user = setupUser();
    await renderReadyApp(macBackend({ wirelessAvailable: false }));
    await user.click(screen.getByRole("button", { name: navStrings.settings }));
    await user.click(screen.getByRole("tab", { name: new RegExp(settingsStrings.categories.kindle) }));

    expect(screen.getByTestId("send-to-kindle-status")).toHaveTextContent(settingsStrings.sendToKindleMissing);
    await user.click(within(screen.getByTestId("send-to-kindle-status")).getByRole("button", { name: settingsStrings.sendToKindleDownload }));
    expect(opener.openExternal).toHaveBeenCalledWith("https://www.amazon.com/sendtokindle/mac");

    await user.click(screen.getByRole("radio", { name: settingsStrings.kindleMethodWireless }));
    expect(await screen.findByTestId("icloud-status")).toHaveTextContent(settingsStrings.icloudOn);

    const folder = screen.getByRole("textbox", { name: settingsStrings.icloudFolder });
    await user.clear(folder);
    await user.type(folder, " Novels/../.x {Enter}");
    await user.clear(folder);
    await user.type(folder, "Novels / PT-BR{Enter}");
    expect(JSON.parse(window.localStorage.getItem(integrationPreferencesKey) ?? "{}")).toEqual({
      kindleMethod: "wireless",
      icloudFolder: "Novels/PT-BR"
    });
  });
});
