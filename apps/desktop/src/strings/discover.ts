/** Labels for the discover (search) view, pt-BR. */
export const discoverStrings = {
  results: "Resultados",
  resultCount: (visible: number, total: number) => `${visible} de ${total} livros`,
  showMore: "Mostrar mais",
  source: "Fonte",
  queueHeading: "Capítulos",
  addToQueue: "Adicionar à fila",
  downloadAgain: "Baixar novamente",
  replaceHint: "Este livro já está na biblioteca. A cópia existente será substituída.",
  alreadyQueuedHint: "Este livro já está na fila de downloads.",
  selectHint: "Selecione um livro",
  configureHint: "Configure o download",
  presetAll: "Todos",
  presetRange: "Faixa",
  selectForQueue: (title: string) => `Selecionar ${title} para download`,
  removeFromQueue: (title: string) => `Desmarcar ${title}`
} as const;
