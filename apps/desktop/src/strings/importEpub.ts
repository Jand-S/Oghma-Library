import type { SeriesSource } from "../services/importClient";

/** Importing the reader's own EPUBs (Biblioteca), pt-BR. */
export const importEpubStrings = {
  button: "Importar EPUB",
  sheetTitle: "Importar EPUB",
  sheetDescription: "Confira os dados antes de guardar. O arquivo original fica onde está.",
  loading: "Lendo os arquivos…",
  cancel: "Cancelar",
  commit: (count: number) => (count === 1 ? "Importar 1 livro" : `Importar ${count.toLocaleString("pt-BR")} livros`),
  titleLabel: "Título",
  authorLabel: "Autor",
  authorPlaceholder: "Desconhecido",
  authorFromCatalog: "Sugerido pelo catálogo",
  seriesLabel: "Série",
  seriesPlaceholder: "Sem série",
  volumeLabel: "Volume",
  volumeInvalid: "Use um número, como 1 ou 2,5",
  volume: (volume: number) => `Volume ${volume.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}`,
  seriesSource: {
    calibre: "Série do Calibre",
    epub3: "Série do EPUB",
    filename: "Série pelo nome do arquivo"
  } satisfies Record<SeriesSource, string>,
  alreadyImported: "Já está na biblioteca",
  invalidFile: "Este arquivo não pôde ser lido como EPUB.",
  coverGenerated: "Capa gerada",
  coverFromLibrary: "Capa de outro volume",
  failedPreview: "Não foi possível ler os arquivos.",
  failedCommit: "Não foi possível importar.",
  missingResult: "A importação deste arquivo não foi confirmada; tente de novo.",
  imported: (count: number) => (count === 1 ? "1 livro importado." : `${count.toLocaleString("pt-BR")} livros importados.`),
  importedPartly: (done: number, failed: number) =>
    `${done.toLocaleString("pt-BR")} importado${done === 1 ? "" : "s"}, ${failed.toLocaleString("pt-BR")} com erro.`
};
