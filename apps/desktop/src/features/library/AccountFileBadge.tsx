// The account badge of imported books: "Enviando…", "Na conta", "Não enviado · Tentar de novo",
// "Só neste computador" (signed out) and "Baixando da conta…" (docs/IMPORT_EPUB.md).
import { Cloud, CloudAlert, Laptop } from "lucide-react";
import type { LibraryItem } from "../../core/types";
import { accountFilesStrings as s } from "../../strings/accountFiles";
import { Badge, Spinner, cx } from "../../ui";
import { isShelf } from "./libraryModel";
import { isImported } from "./seriesModel";
import type { AccountFileState } from "./useAccountFiles";
import "./accountFiles.css";

type StateOf = (item: LibraryItem) => AccountFileState | null;

/**
 * One state for a book or a whole series: a download in progress first, then "only here"
 * (signed out), sending, failed and, when every volume with a folder here is stored, "Na conta".
 * Volumes whose state is not known yet keep the series from saying "Na conta".
 */
export function accountBadgeState(items: LibraryItem[], stateOf: StateOf): AccountFileState | null {
  const imported = items.filter(isImported);
  const downloading = imported.map(stateOf).filter((state): state is AccountFileState => state?.phase === "downloading");
  if (downloading.length) return downloading.length === 1 ? downloading[0] : { phase: "downloading", percent: null };
  const local = imported.filter((item) => !isShelf(item)).map(stateOf);
  if (!local.length) return null;
  if (local.some((state) => state?.phase === "local")) return { phase: "local" };
  const sending = local.filter((state): state is AccountFileState => state?.phase === "queued" || state?.phase === "sending");
  if (sending.length) return sending.length === 1 && sending[0].phase === "sending" ? sending[0] : { phase: "sending", percent: null };
  if (local.some((state) => state?.phase === "failed")) return { phase: "failed" };
  return local.every((state) => state?.phase === "uploaded") ? { phase: "uploaded" } : null;
}

type AccountFileBadgeProps = {
  /** The book, or every volume of a series card. */
  items: LibraryItem[];
  stateOf: StateOf;
  onRetry: (items: LibraryItem[]) => void;
  className?: string;
  /** Inside another button (a card of the editions spread): "Não enviado" without "Tentar de novo". */
  readOnly?: boolean;
};

export function AccountFileBadge({ items, stateOf, onRetry, className, readOnly = false }: AccountFileBadgeProps) {
  const state = accountBadgeState(items, stateOf);
  if (!state) return null;
  const percent = state.percent ?? null;
  const common = { className: cx("library-account", className), "data-testid": "library-account-badge", "data-phase": state.phase };
  switch (state.phase) {
    case "downloading":
      return <Badge tone="accent" {...common}><Spinner size="sm" />{percent === null ? s.downloading : s.downloadingPercent(percent)}</Badge>;
    case "local":
      return <Badge {...common} title={s.localOnlyHint}><Laptop aria-hidden="true" />{s.localOnly}</Badge>;
    case "queued":
    case "sending":
      return <Badge tone="accent" {...common} title={s.sendingHint}><Spinner size="sm" />{percent === null ? s.sending : s.sendingPercent(percent)}</Badge>;
    case "uploaded":
      return <Badge {...common} title={s.inAccountHint}><Cloud aria-hidden="true" />{s.inAccount}</Badge>;
    case "failed":
      if (readOnly) return <Badge tone="warning" {...common}><CloudAlert aria-hidden="true" />{s.notSent}</Badge>;
      return (
        <Badge tone="warning" {...common} data-card-control>
          <CloudAlert aria-hidden="true" />
          {s.notSent}
          <span aria-hidden="true">·</span>
          <button
            type="button"
            className="library-account__retry"
            aria-label={s.retryLabel(items.length === 1 ? items[0].title : items[0].series?.name ?? items[0].title)}
            onClick={(event) => {
              event.stopPropagation();
              onRetry(items);
            }}
          >
            {s.retry}
          </button>
        </Badge>
      );
  }
}
