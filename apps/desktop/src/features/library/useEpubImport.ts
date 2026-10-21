import { useCallback, useEffect, useRef, useState } from "react";
import { getErrorMessage } from "../../services/backendClient";
import type { CatalogIndex } from "../../services/catalogIndex";
import { importApi as defaultApi, type ImportApi, type PickedFile } from "../../services/importClient";
import { importEpubStrings } from "../../strings/importEpub";
import type { ToastTone } from "../../ui";
import { drawImportCover, type CoverText, type GeneratedCover } from "./importCover";
import { commitItemOf, commitOutcome, coverTextOf, draftFromPreview, isImportable, needsGeneratedCover, type ImportDraft, type ImportDraftFields } from "./importModel";

type EpubImportArgs = {
  catalogIndex?: CatalogIndex | null;
  refreshLibrary: () => void;
  notify: (message: string, tone?: ToastTone) => void;
  /** Tests pass a fake; the app uses the Tauri commands. */
  api?: ImportApi;
  /** Typographic cover (canvas); tests pass a fake. */
  drawCover?: (text: CoverText) => GeneratedCover | null;
  /** The keys (`import:<sha>`) just written: they go up to the account in the background. */
  onImported?: (keys: string[]) => void;
};

export type EpubImportController = {
  /** Only the desktop app imports (it keeps the file paths). */
  available: boolean;
  open: boolean;
  loading: boolean;
  committing: boolean;
  drafts: ImportDraft[];
  /** The preview itself failed (no list to show). */
  error: string | null;
  /** `.epub` files are being dragged over the window: the "Solte para importar" overlay shows. */
  dragging: boolean;
  importableCount: number;
  /** "Importar EPUB": native dialog, then the preview sheet. */
  pick: () => Promise<void>;
  update: (id: string, fields: Partial<ImportDraftFields>) => void;
  commit: () => Promise<void>;
  close: () => void;
  drawCover: (text: CoverText) => GeneratedCover | null;
};

/**
 * Importing the reader's own EPUBs: the "Importar EPUB" button and files dropped on the
 * window open the same preview sheet; "Importar N livros" writes the books and rescans the
 * library. Lives at the app level so a drop works on any page.
 */
export function useEpubImport({ catalogIndex, refreshLibrary, notify, api = defaultApi, drawCover = drawImportCover, onImported }: EpubImportArgs): EpubImportController {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [drafts, setDrafts] = useState<ImportDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const indexRef = useRef(catalogIndex);
  indexRef.current = catalogIndex;
  // A newer pick/drop wins over a preview still loading.
  const requestRef = useRef(0);

  const preview = useCallback(async (files: PickedFile[]) => {
    if (!files.length) return;
    const request = ++requestRef.current;
    setOpen(true);
    setLoading(true);
    setError(null);
    setDrafts([]);
    try {
      const previews = await api.preview(files.map((file) => file.id));
      if (request !== requestRef.current) return;
      setDrafts(previews.map((item) => draftFromPreview(item, indexRef.current)));
    } catch (failure) {
      if (request === requestRef.current) setError(getErrorMessage(failure, importEpubStrings.failedPreview));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, [api]);

  const pick = useCallback(async () => {
    try {
      await preview(await api.pick());
    } catch (failure) {
      notify(getErrorMessage(failure, importEpubStrings.failedPreview), "danger");
    }
  }, [api, notify, preview]);

  // Files dropped anywhere on the window (Rust registers the paths and emits the ids), and the
  // drag-over state of .epub files for the overlay.
  useEffect(() => {
    if (!api.available) return;
    let disposed = false;
    const stops: (() => void)[] = [];
    const keep = (stop: () => void) => {
      if (disposed) stop();
      else stops.push(stop);
    };
    void api.onDropped((files) => {
      setDragging(false);
      void preview(files);
    }).then(keep).catch(() => undefined);
    void api.onDragHover(setDragging).then(keep).catch(() => undefined);
    return () => {
      disposed = true;
      stops.forEach((stop) => stop());
      setDragging(false);
    };
  }, [api, preview]);

  const update = useCallback((id: string, fields: Partial<ImportDraftFields>) => {
    setDrafts((current) => current.map((draft) => {
      if (draft.preview.id !== id) return draft;
      const authorFromCatalog = draft.authorFromCatalog && (fields.author === undefined || fields.author === draft.author);
      return { ...draft, ...fields, authorFromCatalog, error: null };
    }));
  }, []);

  const close = useCallback(() => {
    if (committing) return;
    requestRef.current += 1;
    setOpen(false);
    setLoading(false);
    setDrafts([]);
    setError(null);
  }, [committing]);

  const commit = useCallback(async () => {
    const chosen = drafts.filter(isImportable);
    if (!chosen.length || committing) return;
    setCommitting(true);
    try {
      const items = chosen.map((draft) => {
        const cover = needsGeneratedCover(draft.preview) ? drawCover(coverTextOf(draft)) : null;
        return commitItemOf(draft, cover?.bytes ?? null);
      });
      const results = await api.commit(items);
      // Judged per submitted file: one without an answer did not import (no success toast for it).
      const { keys, failed } = commitOutcome(items.map((item) => item.id), results, importEpubStrings.missingResult);
      const done = keys.length;
      if (done > 0) {
        refreshLibrary();
        onImported?.(keys);
      }
      if (!failed.size) {
        notify(importEpubStrings.imported(done), "success");
        setOpen(false);
        setDrafts([]);
        return;
      }
      // Keep only the files that failed, with their error, so the reader can retry them.
      setDrafts((current) => current
        .filter((draft) => failed.has(draft.preview.id))
        .map((draft) => ({ ...draft, error: failed.get(draft.preview.id) ?? null })));
      if (done > 0) notify(importEpubStrings.importedPartly(done, failed.size), "warning");
    } catch (failure) {
      notify(getErrorMessage(failure, importEpubStrings.failedCommit), "danger");
    } finally {
      setCommitting(false);
    }
  }, [api, committing, drafts, drawCover, notify, onImported, refreshLibrary]);

  return {
    available: api.available,
    open,
    loading,
    committing,
    drafts,
    error,
    dragging,
    importableCount: drafts.filter(isImportable).length,
    pick,
    update,
    commit,
    close,
    drawCover
  };
}
