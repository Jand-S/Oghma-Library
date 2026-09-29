/** Labels for the sources view ("Fontes"), pt-BR. */
export const sourcesStrings = {
  summary: (total: number, enabled: number) =>
    `${total} ${total === 1 ? "fonte" : "fontes"} · ${enabled} ${enabled === 1 ? "ativa" : "ativas"}`,
  listLabel: "Fontes de novels",
  syncAll: "Sincronizar ativas",
  sync: "Sincronizar",
  syncSource: (name: string) => `Sincronizar ${name}`,
  openSite: "Abrir site",
  openSiteOf: (name: string) => `Abrir site de ${name}`,
  include: "Incluir na busca",
  columns: {
    source: "Fonte",
    language: "Idioma",
    books: "Novels",
    lastSync: "Última sincronização",
    include: "Na busca",
    actions: "Ações"
  },
  status: {
    online: "Online",
    syncing: "Sincronizando",
    offline: "Offline"
  },
  unknownLanguage: "—",
  search: "Buscar fonte",
  searchPlaceholder: "Buscar por nome ou domínio",
  noMatches: (query: string) => `Nenhuma fonte encontrada para “${query}”.`,
  relative: {
    now: "Agora",
    today: "Hoje",
    minutes: (count: number) => `há ${count} min`,
    hours: (count: number) => `há ${count} h`,
    yesterday: "Ontem",
    days: (count: number) => `há ${count} dias`,
    months: (count: number) => (count === 1 ? "há 1 mês" : `há ${count} meses`),
    years: (count: number) => (count === 1 ? "há 1 ano" : `há ${count} anos`)
  },
  emptyTitle: "Nenhuma fonte disponível",
  emptyDescription: "O servidor de índices não entregou nenhuma fonte. Confira o endereço em Ajustes.",
  openSettings: "Abrir Ajustes",
  syncFailed: "Não foi possível sincronizar a fonte.",
  syncAllDone: "Fontes ativas sincronizadas.",
  syncAllFailed: "Não foi possível sincronizar uma ou mais fontes.",
  loading: "Carregando fontes…"
} as const;
