import { Check, FileCog } from "lucide-react";
import type { LibraryItem } from "../../core/types";
import { downloadFormats } from "../../core/types";
import { uiStrings } from "../../strings/common";
import { libraryStrings } from "../../strings/library";
import { Button, CheckboxField, Chip, Modal } from "../../ui";
import { formatsOf } from "./libraryModel";
import type { LibraryController } from "./useLibraryController";

type ConvertDialogProps = {
  item: LibraryItem | null;
  conversion: LibraryController["conversion"];
  onClose: () => void;
};

/** Picks the missing formats for one book and starts a convert job in the download queue. */
export function ConvertDialog({ item, conversion, onClose }: ConvertDialogProps) {
  const existing = item ? formatsOf(item) : [];
  const missing = Array.from(conversion.converterFormats).filter((format) => !existing.includes(format));
  const canStart = missing.length > 0 || conversion.converterAudiobook;

  const start = () => {
    conversion.startConversion();
    onClose();
  };

  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      title={item ? libraryStrings.convertTitle(item.title) : ""}
      description={libraryStrings.convertDescription}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose}>{uiStrings.cancel}</Button>
          <Button variant="primary" icon={<FileCog />} onClick={start} disabled={!canStart}>
            {libraryStrings.convertStart}
          </Button>
        </>
      )}
    >
      <div className="library-convert">
        <div className="library-convert__formats" role="group" aria-label={libraryStrings.factFormats}>
          {downloadFormats.map((format) => {
            const present = existing.includes(format);
            return (
              <Chip
                key={format}
                selected={present || conversion.converterFormats.has(format)}
                onToggle={() => conversion.toggleConverterFormat(format)}
                disabled={present}
                icon={present ? <Check /> : undefined}
              >
                {present ? `${format} · ${libraryStrings.convertExisting}` : format}
              </Chip>
            );
          })}
        </div>
        <CheckboxField
          label={libraryStrings.audiobookLabel}
          description={libraryStrings.audiobookDescription}
          checked={conversion.converterAudiobook}
          onChange={conversion.toggleConverterAudiobook}
        />
        {!canStart ? <p className="library-convert__hint">{libraryStrings.convertNothing}</p> : null}
      </div>
    </Modal>
  );
}
