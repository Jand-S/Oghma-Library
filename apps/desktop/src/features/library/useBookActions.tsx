import { Cloud, Download, FileCog, FolderOpen, Heart, HeartOff, Info, Send, Trash2, EyeOff, Usb, Wifi } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { ConfirmationModal, type MenuItem } from "../../ui";
import { ConvertDialog } from "./ConvertDialog";
import type { LibraryController } from "./useLibraryController";

type Confirm = { kind: "remove" | "delete"; item: LibraryItem } | null;

type BookActionsArgs = {
  library: LibraryController;
  canRedownload: (item: LibraryItem) => boolean;
  /** Whether a queue job already covers this book (download or conversion). */
  isBusy: (item: LibraryItem) => boolean;
  onOpenDetails: (item: LibraryItem) => void;
};

/**
 * Every per-book action of the library in one place: the context/⋮ menu items and the
 * dialogs they open (remove, delete, convert). Grid, list and details share it.
 */
export function useBookActions({ library, canRedownload, isBusy, onOpenDetails }: BookActionsArgs) {
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const convertItem = convertId ? library.library.find((item) => item.id === convertId) ?? null : null;
  const running = library.conversion.converterRunning;

  const redownloadDisabledReason = (item: LibraryItem) => {
    if (!canRedownload(item)) return libraryStrings.notInCatalog;
    if (isBusy(item)) return libraryStrings.alreadyQueued;
    return undefined;
  };

  const openConvert = (item: LibraryItem) => {
    if (library.prepareConversion([item.id])) setConvertId(item.id);
  };

  const sendToKindle = (item: LibraryItem) => library.sendToKindle([item.id]);

  /**
   * Kindle and iCloud entries. On macOS the Kindle send offers Wi-Fi (Amazon's Send to
   * Kindle app) and the USB cable; elsewhere only the cable, shown while it is connected.
   */
  const sendItems = (item: LibraryItem, options: { menu?: boolean } = {}): MenuItem[] => {
    const blocked = running || isBusy(item);
    const items: MenuItem[] = [];
    if (library.kindleWirelessSupported) {
      const wireless = library.kindleStatus?.wirelessAvailable;
      items.push(
        {
          label: wireless ? (options.menu ? libraryStrings.kindleViaWifiMenu : libraryStrings.kindleViaWifi) : libraryStrings.installSendToKindle,
          icon: <Wifi />,
          onSelect: () => (wireless ? library.sendToKindleWireless([item.id]) : library.offerSendToKindleInstall())
        },
        {
          label: library.kindleConnected
            ? (options.menu ? libraryStrings.kindleViaUsbMenu : libraryStrings.kindleViaUsb)
            : libraryStrings.kindleUsbDisconnected,
          icon: <Usb />,
          onSelect: () => sendToKindle(item),
          disabled: blocked || !library.kindleConnected
        }
      );
    } else if (library.kindleConnected) {
      items.push({ label: libraryStrings.sendToKindle, icon: <Send />, onSelect: () => sendToKindle(item), disabled: blocked });
    }
    if (options.menu && library.icloudAvailable) {
      items.push({ label: libraryStrings.saveToICloud, icon: <Cloud />, onSelect: () => library.saveToICloud([item.id]), disabled: library.savingToICloud });
    }
    return items;
  };

  const askRemove = (item: LibraryItem) => setConfirm({ kind: "remove", item });
  const askDelete = (item: LibraryItem) => setConfirm({ kind: "delete", item });
  const toggleFavorite = (item: LibraryItem) => library.updateLibraryMeta(item, { favorite: !item.favorite });

  /** Full menu for the grid/list context menu and ⋮ buttons. */
  const menuItems = (item: LibraryItem, options: { includeDetails?: boolean } = {}): MenuItem[] => {
    const items: MenuItem[] = [];
    if (options.includeDetails !== false) {
      items.push({ label: libraryStrings.openDetails, icon: <Info />, onSelect: () => onOpenDetails(item) });
    }
    items.push(
      { label: libraryStrings.openFolder, icon: <FolderOpen />, onSelect: () => library.openLibraryItemFolder(item) },
      {
        label: libraryStrings.downloadAgain,
        icon: <Download />,
        onSelect: () => library.redownloadItem(item),
        disabled: Boolean(redownloadDisabledReason(item))
      }
    );
    items.push(...sendItems(item, { menu: true }));
    items.push(
      { label: libraryStrings.convertFormats, icon: <FileCog />, onSelect: () => openConvert(item), disabled: running || isBusy(item) },
      {
        label: item.favorite ? libraryStrings.removeFavorite : libraryStrings.addFavorite,
        icon: item.favorite ? <HeartOff /> : <Heart />,
        onSelect: () => toggleFavorite(item)
      },
      { label: libraryStrings.removeFromLibrary, icon: <EyeOff />, onSelect: () => askRemove(item), separatorBefore: true },
      { label: libraryStrings.deleteFiles, icon: <Trash2 />, onSelect: () => askDelete(item), danger: true }
    );
    return items;
  };

  const dialogs: ReactNode = (
    <>
      <ConfirmationModal
        open={confirm?.kind === "remove"}
        onClose={() => setConfirm(null)}
        title={confirm ? libraryStrings.confirmRemoveTitle(confirm.item.title) : ""}
        description={libraryStrings.confirmRemoveDescription}
        confirmLabel={libraryStrings.confirmRemove}
        onConfirm={() => {
          if (confirm) library.deleteLibraryItems([confirm.item], false);
          setConfirm(null);
        }}
      />
      <ConfirmationModal
        open={confirm?.kind === "delete"}
        tone="danger"
        onClose={() => setConfirm(null)}
        title={confirm ? libraryStrings.confirmDeleteTitle(confirm.item.title) : ""}
        description={libraryStrings.confirmDeleteDescription}
        confirmLabel={libraryStrings.confirmDelete}
        onConfirm={() => {
          if (confirm) library.deleteLibraryItems([confirm.item], true);
          setConfirm(null);
        }}
      />
      <ConvertDialog
        item={convertItem}
        conversion={library.conversion}
        onClose={() => setConvertId(null)}
      />
    </>
  );

  return {
    menuItems,
    dialogs,
    openConvert,
    sendToKindle,
    sendItems,
    askRemove,
    askDelete,
    toggleFavorite,
    redownloadDisabledReason
  };
}

export type BookActions = ReturnType<typeof useBookActions>;
