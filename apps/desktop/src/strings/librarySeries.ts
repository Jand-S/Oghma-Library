/** Series of imported books in the Biblioteca (cards, list rows and the series page), pt-BR. */

const volumeNumber = (volume: number) => volume.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

export const librarySeriesStrings = {
  eyebrow: "Série",
  volumesCount: (count: number) => (count === 1 ? "1 volume" : `${count.toLocaleString("pt-BR")} volumes`),
  /** "Unsheathed · 4 volumes" */
  seriesOf: (name: string, count: number) => `${name} · ${librarySeriesStrings.volumesCount(count)}`,
  volume: (volume: number | null) => (volume === null ? "Sem número" : `Volume ${volumeNumber(volume)}`),
  /** "Vol. 2" in the list, under the volume's title. */
  volumeShort: (volume: number | null) => (volume === null ? "Extra" : `Vol. ${volumeNumber(volume)}`),
  openSeries: "Ver série",
  openSeriesOf: (name: string) => `Ver série: ${name}`,
  seriesActions: (name: string) => `Ações da série ${name}`,
  sendSeries: "Enviar série ao Kindle",
  sendSeriesHint: (count: number) =>
    count === 1 ? "Leva o volume baixado para a página do Kindle, pronto para enviar." : `Leva os ${count} volumes baixados para a página do Kindle, na ordem.`,
  noneDownloaded: "Nenhum volume está neste computador. Baixe um volume para enviar.",
  volumesHeading: "Volumes",
  volumesFooter: "Em ordem de volume. Os que não estão neste computador ficam de fora do envio.",
  open: "Abrir",
  openVolume: (title: string) => `Abrir ${title}`,
  sendVolume: (title: string) => `Enviar ao Kindle: ${title}`,
  removeVolume: (title: string) => `Remover da biblioteca: ${title}`,
  volumeActions: (title: string) => `Mais ações: ${title}`,
  detailLabel: "Série"
};
