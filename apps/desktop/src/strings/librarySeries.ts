/** Series of imported books in the Biblioteca (cards, list rows and the volumes spread), pt-BR. */

const volumeNumber = (volume: number) => volume.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export const librarySeriesStrings = {
  /** Footer of a series card in the grid. */
  eyebrow: "Série",
  volumesCount: (count: number) => (count === 1 ? "1 volume" : `${count.toLocaleString("pt-BR")} volumes`),
  /** "Unsheathed · 4 volumes" */
  seriesOf: (name: string, count: number) => `${name} · ${librarySeriesStrings.volumesCount(count)}`,
  /** "Vol. 2" in the list, under the volume's title. */
  volumeShort: (volume: number | null) => (volume === null ? "Extra" : `Vol. ${volumeNumber(volume)}`),
  /** A volume in the series spread: "Vol. 2 · Broken Wings" (just the title without a number). */
  volumeTitle: (volume: number | null, title: string) => (volume === null ? title : `Vol. ${volumeNumber(volume)} · ${title}`),
  showVolumes: "Ver volumes",
  seriesActions: (name: string) => `Ações da série ${name}`,
  sendSeries: "Enviar série ao Kindle",
  sendSeriesHint: (count: number) =>
    count === 1 ? "Leva o volume baixado para a página do Kindle, pronto para enviar." : `Leva os ${count} volumes baixados para a página do Kindle, na ordem.`,
  noneDownloaded: "Nenhum volume está neste computador. Baixe um volume para enviar."
};
