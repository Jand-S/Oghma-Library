import { Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { normalizeSearchText } from "../../core/tagFilters";
import { socialStrings as t } from "../../strings/social";
import { Cover, Modal, SegmentedControl, TextField } from "../../ui";
import { useSocialEnv, type SharedBook } from "./socialEnv";

export type PickerMode = "library" | "catalog";

/** A book to send in a conversation: from the reader's library, or any book in the catalog. */
export function BookPicker({ mode: opened, to, onClose, onPick }: { mode: PickerMode | null; to?: string; onClose: () => void; onPick: (book: SharedBook) => void }) {
  const env = useSocialEnv();
  const [query, setQuery] = useState("");
  const [switched, setSwitched] = useState<PickerMode | null>(null);
  const wanted = useDeferredValue(query);
  const mode = opened && (switched ?? opened);
  useEffect(() => {
    setQuery("");
    setSwitched(null);
  }, [opened]);
  const library = useMemo(() => (mode === "library" ? env.libraryBooks() : []), [env, mode]);
  const shown = useMemo(() => {
    if (mode === "catalog") return env.searchCatalog(wanted);
    const needle = normalizeSearchText(wanted);
    return needle ? library.filter((book) => normalizeSearchText(`${book.snapshot.title} ${book.snapshot.author ?? ""}`).includes(needle)) : library;
  }, [env, library, mode, wanted]);
  const catalog = mode === "catalog";
  return (
    <Modal
      open={opened !== null}
      onClose={onClose}
      title={catalog ? t.pickCatalogTitle : t.pickBookTitle}
      description={to ? t.pickFor(to) : undefined}
      size="md"
      className="social-picker-modal"
    >
      <SegmentedControl<PickerMode>
        aria-label={t.pickBookTitle}
        size="sm"
        value={mode ?? "library"}
        onChange={setSwitched}
        options={[{ value: "library", label: t.pickLibrary }, { value: "catalog", label: t.pickCatalog }]}
        className="social-picker__modes"
      />
      <TextField
        label={catalog ? t.pickCatalogSearch : t.pickBookSearch}
        hideLabel
        placeholder={catalog ? t.pickCatalogSearch : t.pickBookSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        leading={<Search aria-hidden="true" />}
        autoFocus
      />
      {shown.length ? (
        <ul className="social-picker" data-testid="social-book-picker">
          {shown.map((book) => (
            <li key={book.novelId}>
              <button
                type="button"
                className="social-picker__item"
                onClick={() => {
                  onPick(book);
                  onClose();
                }}
              >
                <span className="social-picker__cover"><Cover src={book.snapshot.coverUrl} title={book.snapshot.title} size="fill" /></span>
                <span className="social-picker__text">
                  <strong>{book.snapshot.title}</strong>
                  <span>{[book.snapshot.author, book.snapshot.sourceName].filter(Boolean).join(" · ")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="social-picker__empty">{catalog && !wanted.trim() ? t.pickCatalogHint : t.pickNothing}</p>
      )}
    </Modal>
  );
}
