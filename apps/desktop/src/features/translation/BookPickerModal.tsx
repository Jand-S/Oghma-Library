import { BookOpenText, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { LibraryItem } from "../../core/types";
import type { ProjectSummary } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, Cover, EmptyState, Modal, TextField } from "../../ui";

type BookPickerModalProps = {
  open: boolean;
  onClose: () => void;
  /** All library books (to count the ones without EPUB). */
  library: LibraryItem[];
  /** Books with an EPUB on disk. */
  books: LibraryItem[];
  projects: ProjectSummary[];
  creating: boolean;
  onCreate: (item: LibraryItem) => Promise<boolean>;
  onBrowse: () => void;
};

const normalize = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** "Traduzir livro": pick a library book with an EPUB and create its project. */
export function BookPickerModal({ open, onClose, library, books, projects, creating, onCreate, onBrowse }: BookPickerModalProps) {
  const [query, setQuery] = useState("");
  const [pickedId, setPickedId] = useState("");

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setPickedId("");
  }, [open]);

  const inProject = useMemo(() => {
    const ids = new Set(projects.map((project) => project.sourceNovelId).filter(Boolean));
    const titles = new Set(projects.map((project) => project.title));
    return (item: LibraryItem) => (item.novelId ? ids.has(item.novelId) : false) || titles.has(item.title);
  }, [projects]);

  const shown = useMemo(() => {
    const needle = normalize(query.trim());
    return books.filter((item) => !needle || normalize(`${item.title} ${item.author}`).includes(needle));
  }, [books, query]);

  const hidden = library.filter((item) => !item.novelId?.endsWith(":pt-BR")).length - books.length;
  const picked = books.find((item) => item.id === pickedId) ?? null;

  const create = async () => {
    if (!picked) return;
    if (await onCreate(picked)) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t.pickerTitle}
      description={t.pickerDescription}
      dismissible={!creating}
      className="translation-picker"
      footer={books.length > 0 ? (
        <>
          <Button variant="ghost" onClick={onClose} disabled={creating}>{t.cancel}</Button>
          <Button variant="primary" onClick={() => void create()} disabled={!picked} loading={creating}>{t.pickerCreate}</Button>
        </>
      ) : undefined}
    >
      {books.length === 0 ? (
        <EmptyState
          icon={<BookOpenText />}
          title={t.pickerEmptyTitle}
          description={t.pickerEmptyDescription}
          action={<Button variant="primary" icon={<Search />} onClick={onBrowse}>{t.pickerOpenLibrary}</Button>}
        />
      ) : (
        <div className="translation-picker__body">
          <TextField
            label={t.pickerSearch}
            hideLabel
            placeholder={t.pickerSearch}
            leading={<Search />}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {shown.length === 0 ? (
            <p className="translation-picker__note">{t.pickerNoMatch}</p>
          ) : (
            <ul className="translation-picker__list" aria-label={t.pickerList}>
              {shown.map((item) => {
                const taken = inProject(item);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      className="translation-picker__item"
                      aria-pressed={item.id === pickedId}
                      disabled={taken}
                      data-testid="translation-picker-book"
                      onClick={() => setPickedId(item.id)}
                      onDoubleClick={() => {
                        setPickedId(item.id);
                        if (!taken) void onCreate(item).then((ok) => ok && onClose());
                      }}
                    >
                      <Cover size="sm" src={item.coverUrl} title={item.title} />
                      <span className="translation-picker__text">
                        <span className="translation-picker__title">{item.title}</span>
                        <span className="translation-picker__meta">
                          {[item.author, item.chapters ? t.pickerChapters(item.chapters) : ""].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {taken ? <Badge>{t.pickerAlready}</Badge> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {hidden > 0 ? <p className="translation-picker__note">{t.pickerHiddenCount(hidden)}</p> : null}
        </div>
      )}
    </Modal>
  );
}
