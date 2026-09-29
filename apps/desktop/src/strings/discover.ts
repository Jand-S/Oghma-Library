/** Labels for the discover (search) view, pt-BR. */
export const discoverStrings = {
  results: "Resultados",
  resultCount: (visible: number, total: number) => `${visible} de ${total} livros`,
  showMore: "Mostrar mais",
  source: "Fonte",
  queueHeading: "Capítulos",
  addToQueue: "Adicionar à fila",
  presetAll: "Todos",
  presetRange: "Faixa",
  selectForQueue: (title: string) => `Selecionar ${title} para a fila`,
  removeFromQueue: (title: string) => `Remover ${title} da fila`,
  expandSelection: (title: string) => `Expandir configuração de ${title}`,
  collapseSelection: (title: string) => `Recolher configuração de ${title}`
} as const;
