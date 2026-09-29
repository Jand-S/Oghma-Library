/**
 * User-facing labels shared across views (pt-BR).
 *
 * Views render these constants and tests query by them, so copy can change in
 * one place without breaking the suite.
 */
export const commonStrings = {
  filters: "Filtros",
  showFilters: "Mostrar filtros",
  hideFilters: "Ocultar filtros",
  search: "Busca",
  clear: "Limpar",
  all: "Todos",
  formats: "Formatos",
  audiobook: "Audiobook",
  synopsis: "Sinopse",
  queueTab: "Fila",
  detailsTab: "Detalhes",
  dropToRemove: "Solte para remover",
  sending: "Enviando..."
} as const;

export const windowControlStrings = {
  minimize: "Minimizar",
  maximize: "Maximizar",
  close: "Fechar"
} as const;

export const navStrings = {
  discover: "Buscar",
  sources: "Fontes",
  downloads: "Downloads",
  library: "Biblioteca",
  translation: "Tradução",
  settings: "Ajustes"
} as const;

export const kindleStrings = {
  connected: "Kindle conectado",
  disconnected: "Kindle desconectado"
} as const;
