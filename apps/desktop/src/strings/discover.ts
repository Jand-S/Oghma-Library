/** Labels for the discover (search) view, pt-BR. */
export const discoverStrings = {
  // Toolbar
  source: "Fonte",
  search: "Buscar livros",
  searchPlaceholder: "Buscar por título ou autor",
  clearSearch: "Limpar busca",
  sortAsc: "Ordem alfabética: A–Z",
  sortDesc: "Ordem alfabética: Z–A",
  resultsTotal: (total: number) => `${total.toLocaleString("pt-BR")} ${total === 1 ? "livro" : "livros"}`,
  searching: "Buscando…",
  allSources: "Todas as fontes",

  // Results
  results: "Resultados",
  resultCount: (visible: number, total: number) =>
    `Mostrando ${visible.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`,
  showMore: "Mostrar mais",
  selectForQueue: (title: string) => `Selecionar ${title} para download`,
  removeFromQueue: (title: string) => `Desmarcar ${title}`,
  chaptersShort: (count: number) => `${count.toLocaleString("pt-BR")} cap.`,
  /** Coleta ainda incompleta: "467/967 cap.". */
  chaptersShortOf: (count: number, total: number) => `${count.toLocaleString("pt-BR")}/${total.toLocaleString("pt-BR")} cap.`,
  gridHint: "Use as setas para navegar e Enter para selecionar.",

  // Filter bar and popovers
  filtersHeading: "Filtros",
  clearFilters: "Limpar filtros",
  clear: "Limpar",
  clearAll: "Limpar tudo",
  status: "Status",
  statusAny: "Qualquer status",
  language: "Idioma",
  languageAll: "Todos os idiomas",
  contentRating: "Classificação",
  ratingAll: "Todas",
  ratingSafe: "Livre",
  ratingSuggestive: "Sugestivo",
  ratingErotic: "+18",
  chapters: "Capítulos",
  chaptersMin: "Mínimo de capítulos",
  chaptersMax: "Máximo de capítulos",
  chaptersMinPlaceholder: "Mín.",
  chaptersMaxPlaceholder: "Máx.",
  chaptersCustom: "Personalizado",
  chaptersAny: "Qualquer quantidade",
  chaptersUpTo: (max: number) => `Até ${max.toLocaleString("pt-BR")}`,
  chaptersFrom: (min: number) => `${min.toLocaleString("pt-BR")}+`,
  chaptersBetween: (min: number, max: number) => `${min.toLocaleString("pt-BR")}–${max.toLocaleString("pt-BR")}`,
  tags: "Tags",
  tagsHint: "Clique uma vez para exigir e de novo para excluir.",
  tagSearch: "Buscar tags",
  tagCategory: "Categoria de tags",
  tagCategoryAll: "Todas",
  tagCategoryFormat: "Formato",
  tagCategoryGenre: "Gênero",
  tagCategoryTheme: "Tema",
  tagsEmpty: "Nenhuma tag encontrada.",
  tagsCount: (count: number) => `Tags · ${count.toLocaleString("pt-BR")}`,
  clearTags: "Limpar tags",
  tagIncluded: "exigida",
  tagExcluded: "excluída",

  // Active filter chips
  activeFilters: "Filtros ativos",
  querySummary: (query: string) => `“${query}”`,
  chaptersSummary: (min: number | null, max: number | null) =>
    min != null && max != null
      ? `${min.toLocaleString("pt-BR")}–${max.toLocaleString("pt-BR")} capítulos`
      : min != null
      ? `${min.toLocaleString("pt-BR")}+ capítulos`
      : `Até ${(max ?? 0).toLocaleString("pt-BR")} capítulos`,
  removeFilter: (label: string) => `Remover filtro ${label}`,

  // Empty and error states
  noResultsTitle: "Nenhum livro encontrado",
  noResultsDescription: "Nenhum livro combina com a busca e os filtros atuais.",
  noSourcesTitle: "Nenhuma fonte ativa",
  noSourcesDescription: "Ative uma fonte para explorar o acervo e baixar livros.",
  notSyncedTitle: "Fonte ainda não sincronizada",
  notSyncedDescription: (source: string) => `Sincronize ${source} em Fontes para ver os livros dela aqui.`,
  openSources: "Abrir Fontes",
  offlineTitle: "Servidor indisponível",
  offlineDescription: "Não foi possível falar com o servidor de índice. Verifique a conexão e tente de novo.",
  retry: "Tentar novamente",
  openSettings: "Abrir Ajustes",

  // Detail panel
  detailsLabel: "Detalhes do livro",
  closeDetails: "Fechar detalhes",
  previewBadge: "Pré-visualização",
  chaptersCount: (count: number) => `${count.toLocaleString("pt-BR")} ${count === 1 ? "capítulo" : "capítulos"}`,
  rating: (value: number, votes?: number) =>
    `★ ${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}${votes ? ` (${votes.toLocaleString("pt-BR")})` : ""}`,
  ratingLabel: (value: number, votes?: number) =>
    `Nota ${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} de 5${votes ? `, ${votes.toLocaleString("pt-BR")} avaliações` : ""}`,
  chaptersCountOf: (count: number, total: number) => `${count.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")} capítulos`,
  chaptersIncompleteHint: (missing: number) => `O site tem ${missing.toLocaleString("pt-BR")} capítulos que o servidor ainda está coletando. Eles entram no download quando a coleta terminar.`,
  updated: (when: string) => `Atualizado: ${when}`,
  synopsis: "Sinopse",
  noSynopsis: "Sem sinopse cadastrada para este livro.",
  showMoreSynopsis: "Mostrar mais",
  showLessSynopsis: "Mostrar menos",
  moreTags: (count: number) => `+${count.toLocaleString("pt-BR")}`,
  moreTagsLabel: (count: number) => `Mostrar mais ${count.toLocaleString("pt-BR")} ${count === 1 ? "tag" : "tags"}`,
  lessTags: "Menos",
  lessTagsLabel: "Mostrar menos tags",

  // Download configurator
  queueHeading: "Download",
  formats: "Formatos",
  chapterPreset: "Capítulos a baixar",
  presetAll: "Todos",
  presetRange: "Faixa",
  rangeStart: "Do capítulo",
  rangeEnd: "Até o capítulo",
  audiobook: "Gerar audiobook",
  audiobookDescription: "Narração em áudio junto com o livro.",
  selectionSummary: (count: number) => `${count.toLocaleString("pt-BR")} ${count === 1 ? "capítulo" : "capítulos"} no download`,
  addToQueue: "Baixar",
  downloadAgain: "Baixar novamente",
  queued: "Na fila",
  adding: "Preparando…",
  replaceHint: "Este livro já está na biblioteca. A cópia existente será substituída.",
  alreadyQueuedHint: "Este livro já está na fila de downloads.",
  selectFromPreview: "Selecionar para baixar",
  previewHint: "Pré-visualização. Esc fecha."
} as const;
