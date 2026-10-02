import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LibraryItem } from "../core/types";
import { TranslationBadge } from "../features/library/LibraryCollection";
import { filterLibrary, isTranslated } from "../features/library/libraryModel";
import { libraryStrings } from "../strings/library";

const book = (overrides: Partial<LibraryItem>): LibraryItem =>
  ({ id: overrides.title ?? "x", title: "Livro", author: "", format: "EPUB", formats: ["EPUB"], ...overrides }) as LibraryItem;

describe("translated books in the library", () => {
  const original = book({ title: "Original" });
  const finished = book({ title: "Livro (PT-BR)", language: "pt-BR", translatedFrom: "cn:livro" });
  const preview = book({ title: "Outro (PT-BR)", language: "pt-BR", translationProgress: 42 });

  it("detects translated books and filters them", () => {
    expect(isTranslated(original)).toBe(false);
    expect(isTranslated(finished)).toBe(true);
    expect(isTranslated(book({ analysisFormat: "translation" }))).toBe(true);
    const only = filterLibrary([original, finished, preview], { query: "", formats: new Set(), favoritesOnly: false, translatedOnly: true, sort: "title" });
    expect(only.map((item) => item.title)).toEqual(["Livro (PT-BR)", "Outro (PT-BR)"]);
  });

  it("shows PT-BR or the preview percentage", () => {
    const { rerender, container } = render(<TranslationBadge item={finished} />);
    expect(screen.getByTestId("library-translation-badge")).toHaveTextContent(libraryStrings.translatedBadge);
    rerender(<TranslationBadge item={preview} />);
    expect(screen.getByTestId("library-translation-badge")).toHaveTextContent(libraryStrings.previewBadge(42));
    rerender(<TranslationBadge item={original} />);
    expect(container).toBeEmptyDOMElement();
  });
});
