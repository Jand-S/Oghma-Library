/** Labels for the local library view, pt-BR. */
export const libraryStrings = {
  kindleQueueHeading: "Envio ao Kindle",
  conversionQueueHeading: "Conversão",
  sendToKindle: "Enviar para o Kindle",
  convertQueue: "Converter fila",
  converting: "Convertendo...",
  downloadAgain: "Baixar novamente",
  notInCatalog: "Livro não encontrado no catálogo",
  alreadyQueued: "Este livro já está na fila",
  conversionDone: "Conversão concluída.",
  kindleSent: (count: number) => `${count} livro(s) enviado(s) ao Kindle na ordem da fila.`,
  conversionSkipped: (title: string) => `${title} já está na fila de downloads; ignorado.`,
  conversionFailed: (count: number) => `${count} livro(s) não puderam ser convertidos.`
} as const;
