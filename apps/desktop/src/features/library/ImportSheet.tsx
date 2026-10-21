import { FileUp } from "lucide-react";
import { useMemo } from "react";
import { importEpubStrings as strings } from "../../strings/importEpub";
import { Badge, Banner, Button, Cover, Modal, Spinner, TextField } from "../../ui";
import { coverTextOf, needsGeneratedCover, volumeBlocks, type ImportDraft } from "./importModel";
import type { EpubImportController } from "./useEpubImport";
import { useSettledValue } from "./useSettledValue";
import "./importSheet.css";

type ImportSheetProps = {
  importer: EpubImportController;
  /** Cover URL of a library book (another volume whose cover the import reuses). */
  libraryCover?: (id: string) => string | undefined;
};

/** The generated cover is redrawn once the reader stops typing for this long. */
const COVER_REDRAW_MS = 250;

function ImportRow({ draft, importer, libraryCover }: { draft: ImportDraft; importer: EpubImportController; libraryCover?: ImportSheetProps["libraryCover"] }) {
  const { preview } = draft;
  const generated = needsGeneratedCover(preview);
  const typed = coverTextOf(draft);
  const text = useSettledValue(typed, `${typed.series}\n${typed.volume ?? ""}\n${typed.subtitle}`, COVER_REDRAW_MS);
  const { drawCover } = importer;
  // Redrawn only when the text on the cover changes (and settles).
  const generatedUrl = useMemo(
    () => (generated ? drawCover({ series: text.series, volume: text.volume, subtitle: text.subtitle })?.dataUrl : undefined),
    [drawCover, generated, text.series, text.volume, text.subtitle]
  );
  const coverUrl = preview.coverDataUrl ?? (preview.coverFromLibrary ? libraryCover?.(preview.coverFromLibrary) : undefined) ?? generatedUrl;
  const locked = Boolean(preview.error) || importer.committing;
  const volumeInvalid = volumeBlocks(draft);
  const set = (field: "title" | "author" | "seriesName" | "volume") => (event: { target: { value: string } }) =>
    importer.update(preview.id, { [field]: event.target.value });

  return (
    <li className="library-import__item" data-testid="import-item" aria-label={preview.fileName}>
      <div className="library-import__cover">
        <Cover src={coverUrl} title={draft.title || preview.fileName} size="fill" />
        {generated ? <span className="library-import__cover-note">{strings.coverGenerated}</span> : null}
        {!preview.coverDataUrl && preview.coverFromLibrary ? <span className="library-import__cover-note">{strings.coverFromLibrary}</span> : null}
      </div>
      <div className="library-import__body">
        <div className="library-import__head">
          <span className="library-import__file" title={preview.fileName}>{preview.fileName}</span>
          <div className="library-import__badges">
            {preview.seriesSource ? <Badge data-testid="import-series-source">{strings.seriesSource[preview.seriesSource]}</Badge> : null}
            {preview.alreadyImported ? <Badge tone="warning" data-testid="import-already">{strings.alreadyImported}</Badge> : null}
          </div>
        </div>
        {preview.error ? (
          <Banner tone="danger" title={strings.invalidFile} data-testid="import-error">{preview.error}</Banner>
        ) : (
          <div className="library-import__fields">
            <TextField label={strings.titleLabel} value={draft.title} onChange={set("title")} disabled={locked} fieldClassName="library-import__wide" />
            <TextField
              label={strings.authorLabel}
              value={draft.author}
              placeholder={strings.authorPlaceholder}
              hint={draft.authorFromCatalog ? strings.authorFromCatalog : undefined}
              onChange={set("author")}
              disabled={locked}
              fieldClassName="library-import__wide"
            />
            <TextField label={strings.seriesLabel} value={draft.seriesName} placeholder={strings.seriesPlaceholder} onChange={set("seriesName")} disabled={locked} />
            <TextField
              label={strings.volumeLabel}
              value={draft.volume}
              inputMode="decimal"
              error={volumeInvalid ? strings.volumeInvalid : undefined}
              onChange={set("volume")}
              disabled={locked || !draft.seriesName.trim()}
            />
          </div>
        )}
        {draft.error ? <Banner tone="danger" title={strings.failedCommit} data-testid="import-error">{draft.error}</Banner> : null}
      </div>
    </li>
  );
}

/** Preview sheet of the files picked or dropped: check and edit, then "Importar N livros". */
export function ImportSheet({ importer, libraryCover }: ImportSheetProps) {
  const count = importer.importableCount;
  return (
    <Modal
      open={importer.open}
      onClose={importer.close}
      dismissible={!importer.committing}
      size="lg"
      title={strings.sheetTitle}
      description={strings.sheetDescription}
      className="library-import"
      footer={(
        <>
          <Button variant="ghost" onClick={importer.close} disabled={importer.committing}>{strings.cancel}</Button>
          <Button
            variant="primary"
            icon={<FileUp />}
            onClick={() => void importer.commit()}
            disabled={count === 0 || importer.loading}
            loading={importer.committing}
            data-testid="import-commit"
          >
            {strings.commit(count)}
          </Button>
        </>
      )}
    >
      {importer.loading ? (
        <div className="library-import__loading" role="status"><Spinner size="sm" />{strings.loading}</div>
      ) : importer.error ? (
        <Banner tone="danger" title={strings.failedPreview} role="alert">{importer.error}</Banner>
      ) : (
        <ul className="library-import__list" aria-label={strings.sheetTitle}>
          {importer.drafts.map((draft) => (
            <ImportRow key={draft.preview.id} draft={draft} importer={importer} libraryCover={libraryCover} />
          ))}
        </ul>
      )}
    </Modal>
  );
}
