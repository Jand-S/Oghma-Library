import type { LibraryItem, Novel } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Button, Cover, ListGroup, Modal } from "../../ui";

type EditionsDialogProps = {
  item: LibraryItem | null;
  editions: Novel[];
  onClose: () => void;
  onPick: (novel: Novel) => void;
};

/** "Procurar em outra fonte": the same work published elsewhere, most complete first. */
export function EditionsDialog({ item, editions, onClose, onPick }: EditionsDialogProps) {
  return (
    <Modal
      open={Boolean(item)}
      onClose={onClose}
      size="md"
      title={libraryStrings.otherEditionsTitle}
      description={editions.length ? libraryStrings.otherEditionsDescription : libraryStrings.noOtherEdition}
      footer={<Button variant="ghost" onClick={onClose}>{libraryStrings.cancel}</Button>}
    >
      {editions.length ? (
        <ListGroup>
          {editions.map((novel) => (
            <div key={novel.id} role="listitem" className="library-edition" data-testid="library-edition">
              <Cover src={novel.coverUrl} title={novel.title} size="sm" />
              <div className="library-edition__text">
                <strong>{novel.title}</strong>
                <span>{[novel.sourceName, libraryStrings.editionChapters(novel.chapters)].join(" · ")}</span>
              </div>
              <Button size="sm" variant="outline" onClick={() => onPick(novel)}>{libraryStrings.useEdition}</Button>
            </div>
          ))}
        </ListGroup>
      ) : null}
    </Modal>
  );
}
