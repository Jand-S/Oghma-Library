import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import type { BookSnapshot } from "../../core/types";
import { normalizeSearchText } from "../../core/tagFilters";
import { socialStrings as t } from "../../strings/social";
import { Cover, Modal, TextField } from "../../ui";
import { useSocialEnv } from "./socialEnv";

/** "Anexar livro": a book of the reader's library to send in a conversation. */
export function BookPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (book: { novelId: string; snapshot: BookSnapshot }) => void }) {
  const env = useSocialEnv();
  const [query, setQuery] = useState("");
  const books = useMemo(() => (open ? env.libraryBooks() : []), [env, open]);
  const shown = useMemo(() => {
    const wanted = normalizeSearchText(query);
    return wanted ? books.filter((book) => normalizeSearchText(book.snapshot.title).includes(wanted)) : books;
  }, [books, query]);
  return (
    <Modal open={open} onClose={onClose} title={t.pickBookTitle} size="md">
      <TextField
        label={t.pickBookSearch}
        hideLabel
        placeholder={t.pickBookSearch}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        leading={<Search aria-hidden="true" />}
        autoFocus
      />
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
              <Cover src={book.snapshot.coverUrl} title={book.snapshot.title} size="sm" />
              <span className="social-picker__text">
                <strong>{book.snapshot.title}</strong>
                <span>{[book.snapshot.author, book.snapshot.sourceName].filter(Boolean).join(" · ")}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
