import { CloudDownload, Download, Eye, FileCog, FolderOpen, Heart, HeartOff, Image, ImageOff, Info, Search, Trash2, EyeOff } from "lucide-react";
import { useCoverControls } from "../../app/coverPrivacy";
import { useRef, useState, type ReactNode } from "react";
import type { LibraryItem, LibraryReadingStatus, Novel } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { AppleLogo, Button, ConfirmationModal, Modal, StarRating, type MenuItem } from "../../ui";
import { ConvertDialog } from "./ConvertDialog";
import { EditionsDialog } from "./EditionsDialog";
import { isShelf } from "./libraryModel";
import { readingStatuses, ReadingStatusIcon } from "./ReadingStatus";
import type { LibraryController } from "./useLibraryController";

type Confirm = { kind: "remove" | "delete" | "remove-shelf"; item: LibraryItem } | null;

type BookActionsArgs = {
  library: LibraryController;
  canRedownload: (item: LibraryItem) => boolean;
  /** Whether a queue job already covers this book (download or conversion). */
  isBusy: (item: LibraryItem) => boolean;
  onOpenDetails: (item: LibraryItem) => void;
  /** The same work in other sources (catalog "Também em"); empty without a catalog. */
  editionsOf?: (item: LibraryItem) => Novel[];
};

/**
 * Every per-book action of the library in one place: the context/⋮ menu items and the
 * dialogs they open (remove, delete, convert, rate, other editions). Grid, list and details share it.
 */
export function useBookActions({ library, canRedownload, isBusy, onOpenDetails, editionsOf }: BookActionsArgs) {
  const covers = useCoverControls();
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [convertId, setConvertId] = useState<string | null>(null);
  const [rateId, setRateId] = useState<string | null>(null);
  const [editionsId, setEditionsId] = useState<string | null>(null);
  const byId = (id: string | null) => (id ? library.allLibrary.find((item) => item.id === id) ?? null : null);
  const convertItem = convertId ? library.library.find((item) => item.id === convertId) ?? null : null;
  const rateItem = byId(rateId);
  const editionsItem = byId(editionsId);
  const running = library.conversion.converterRunning;
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);

  const redownloadDisabledReason = (item: LibraryItem) => {
    if (!canRedownload(item) || item.unavailable) return libraryStrings.notInCatalog;
    if (isBusy(item)) return libraryStrings.alreadyQueued;
    return undefined;
  };

  const openConvert = (item: LibraryItem) => {
    if (library.prepareConversion([item.id])) setConvertId(item.id);
  };

  const askRemove = (item: LibraryItem) => setConfirm({ kind: isShelf(item) ? "remove-shelf" : "remove", item });
  const askDelete = (item: LibraryItem) => setConfirm({ kind: "delete", item });
  const toggleFavorite = (item: LibraryItem) => library.updateLibraryMeta(item, { favorite: !item.favorite });
  const rate = (item: LibraryItem, rating: number | null) => library.updateLibraryMeta(item, { rating });
  const askRating = (item: LibraryItem) => setRateId(item.id);
  const findOtherEdition = (item: LibraryItem) => setEditionsId(item.id);

  /** Finishing or dropping a book without a rating asks for one (once, in a small sheet). */
  const setStatus = (item: LibraryItem, readingStatus: LibraryReadingStatus) => {
    library.updateLibraryMeta(item, { readingStatus });
    if ((readingStatus === "completed" || readingStatus === "dropped") && !item.rating && item.readingStatus !== readingStatus) {
      setRateId(item.id);
    }
  };

  const statusItems = (item: LibraryItem): MenuItem[] => readingStatuses.map((status, index) => ({
    label: libraryStrings.readingStatusLabels[status],
    icon: <ReadingStatusIcon status={status} />,
    checked: (item.readingStatus ?? "unread") === status,
    heading: index === 0 ? libraryStrings.statusMenu : undefined,
    separatorBefore: index === 0,
    onSelect: () => setStatus(item, status)
  }));

  /** Full menu for the grid/list context menu and ⋮ buttons. */
  /** "Ocultar esta capa" / "Sempre mostrar esta capa" (catalog books only). */
  const coverItem = (item: LibraryItem): MenuItem | null => {
    if (!item.novelId || item.language || !item.coverUrl) return null;
    const hidden = covers.isHidden(item.novelId);
    return {
      label: hidden ? libraryStrings.alwaysShowCover : libraryStrings.hideCover,
      icon: hidden ? <Image /> : <ImageOff />,
      onSelect: () => covers.toggle(item.novelId!),
      separatorBefore: true
    };
  };

  const menuItems = (item: LibraryItem, options: { includeDetails?: boolean } = {}): MenuItem[] => {
    const items: MenuItem[] = [];
    const shelf = isShelf(item);
    if (options.includeDetails !== false) {
      items.push({ label: libraryStrings.openDetails, icon: <Info />, onSelect: () => onOpenDetails(item) });
    }
    if (shelf) {
      items.push({
        label: libraryStrings.download,
        icon: <CloudDownload />,
        onSelect: () => library.redownloadItem(item),
        disabled: Boolean(redownloadDisabledReason(item))
      });
      if (item.unavailable && editionsOf) {
        items.push({ label: libraryStrings.findOtherEdition, icon: <Search />, onSelect: () => findOtherEdition(item) });
      }
    } else {
      items.push(
        { label: libraryStrings.openFolder, icon: <FolderOpen />, onSelect: () => library.openLibraryItemFolder(item) },
        {
          label: libraryStrings.downloadAgain,
          icon: <Download />,
          onSelect: () => library.redownloadItem(item),
          disabled: Boolean(redownloadDisabledReason(item))
        }
      );
      if (library.icloudAvailable) {
        items.push({ label: libraryStrings.saveToICloud, icon: <AppleLogo />, onSelect: () => library.saveToICloud([item.id]), disabled: library.savingToICloud });
      }
      items.push({ label: libraryStrings.convertFormats, icon: <FileCog />, onSelect: () => openConvert(item), disabled: running || isBusy(item) });
    }
    items.push({
      label: item.favorite ? libraryStrings.removeFavorite : libraryStrings.addFavorite,
      icon: item.favorite ? <HeartOff /> : <Heart />,
      onSelect: () => toggleFavorite(item)
    });
    items.push(...statusItems(item));
    const cover = coverItem(item);
    if (cover) items.push(cover);
    items.push(item.hidden
      ? { label: libraryStrings.showInLibrary, icon: <Eye />, onSelect: () => library.unhideLibraryItem(item), separatorBefore: true }
      : { label: libraryStrings.removeFromLibrary, icon: <EyeOff />, onSelect: () => askRemove(item), separatorBefore: true });
    if (!shelf) items.push({ label: libraryStrings.deleteFiles, icon: <Trash2 />, onSelect: () => askDelete(item), danger: true });
    return items;
  };

  const deleteItem = confirm?.kind === "delete" ? confirm.item : null;
  // Books from the catalog can stay in the library without files; local-only books cannot.
  const canKeepOnShelf = Boolean(deleteItem?.novelId && !deleteItem.language);
  const closeConfirm = () => setConfirm(null);

  const dialogs: ReactNode = (
    <>
      <ConfirmationModal
        open={confirm?.kind === "remove"}
        onClose={closeConfirm}
        title={confirm ? libraryStrings.confirmRemoveTitle(confirm.item.title) : ""}
        description={libraryStrings.confirmRemoveDescription}
        confirmLabel={libraryStrings.confirmRemove}
        onConfirm={() => {
          if (confirm) library.deleteLibraryItems([confirm.item], false);
          closeConfirm();
        }}
      />
      <ConfirmationModal
        open={confirm?.kind === "remove-shelf"}
        onClose={closeConfirm}
        title={confirm ? libraryStrings.confirmShelfRemoveTitle(confirm.item.title) : ""}
        description={libraryStrings.confirmShelfRemoveDescription}
        confirmLabel={libraryStrings.confirmRemove}
        tone="danger"
        onConfirm={() => {
          if (confirm) library.deleteLibraryItems([confirm.item], false);
          closeConfirm();
        }}
      />
      <ConfirmationModal
        open={Boolean(deleteItem) && !canKeepOnShelf}
        tone="danger"
        onClose={closeConfirm}
        title={deleteItem ? libraryStrings.confirmDeleteTitle(deleteItem.title) : ""}
        description={libraryStrings.confirmDeleteDescription}
        confirmLabel={libraryStrings.confirmDelete}
        onConfirm={() => {
          if (deleteItem) library.deleteLibraryItems([deleteItem], true);
          closeConfirm();
        }}
      />
      <Modal
        open={Boolean(deleteItem) && canKeepOnShelf}
        onClose={closeConfirm}
        size="sm"
        title={deleteItem ? libraryStrings.confirmDeleteTitle(deleteItem.title) : ""}
        description={libraryStrings.confirmDeleteChoice}
        // Like the other danger confirmations, Cancel takes the focus first.
        initialFocus={cancelDeleteRef}
        footer={(
          <>
            <Button ref={cancelDeleteRef} variant="ghost" onClick={closeConfirm}>{libraryStrings.cancel}</Button>
            <Button
              variant="danger"
              data-testid="library-delete-all"
              onClick={() => {
                if (deleteItem) library.deleteLibraryItems([deleteItem], true, false);
                closeConfirm();
              }}
            >
              {libraryStrings.confirmDeleteAll}
            </Button>
            <Button
              variant="primary"
              data-testid="library-delete-keep"
              onClick={() => {
                if (deleteItem) library.deleteLibraryItems([deleteItem], true, true);
                closeConfirm();
              }}
            >
              {libraryStrings.confirmDeleteKeep}
            </Button>
          </>
        )}
      />
      <Modal
        open={Boolean(rateItem)}
        onClose={() => setRateId(null)}
        size="sm"
        title={libraryStrings.ratePromptTitle}
        description={rateItem?.title}
        footer={<Button variant="ghost" onClick={() => setRateId(null)}>{libraryStrings.notNow}</Button>}
      >
        <div className="library-rate">
          <StarRating
            size="md"
            label={libraryStrings.ratingLabel}
            value={rateItem?.rating}
            onChange={(value) => {
              if (rateItem) rate(rateItem, value);
              if (value) window.setTimeout(() => setRateId(null), 280);
            }}
          />
          <p className="library-rate__hint">{libraryStrings.ratePromptHint}</p>
        </div>
      </Modal>
      <EditionsDialog
        item={editionsItem}
        editions={editionsItem && editionsOf ? editionsOf(editionsItem) : []}
        onClose={() => setEditionsId(null)}
        onPick={(novel) => {
          if (editionsItem) library.swapEdition(editionsItem, novel);
          setEditionsId(null);
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
    askRemove,
    askDelete,
    toggleFavorite,
    coverItem,
    rate,
    askRating,
    setStatus,
    findOtherEdition,
    /** Downloads a shelf book (or downloads a local one again). */
    download: (item: LibraryItem) => library.redownloadItem(item),
    redownloadDisabledReason
  };
}

export type BookActions = ReturnType<typeof useBookActions>;
