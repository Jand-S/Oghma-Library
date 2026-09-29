/** Labels for the sources view ("Fontes"), pt-BR. */
export const sourcesStrings = {
  summary: (total: number, enabled: number) =>
    `${total} ${total === 1 ? "fonte" : "fontes"} · ${enabled} ${enabled === 1 ? "ativa" : "ativas"}`,
  lead: "Fontes ativas entram na busca e na sincronização de índices.",
  syncAll: "Sincronizar ativas",
  sync: "Sincronizar",
  syncSource: (name: string) => `Sincronizar ${name}`,
  include: "Incluir na busca",
  language: "Idioma",
  books: "Novels",
  lastSync: "Última sincronização",
  mode: "Tipo",
  status: {
    online: "Online",
    syncing: "Sincronizando",
    offline: "Offline"
  },
  disabled: "Desativada",
  unknownLanguage: "—",
  emptyTitle: "Nenhuma fonte disponível",
  emptyDescription: "O servidor de índices não entregou nenhuma fonte. Confira o endereço em Ajustes.",
  openSettings: "Abrir Ajustes",
  syncFailed: "Não foi possível sincronizar a fonte.",
  syncAllDone: "Fontes ativas sincronizadas.",
  syncAllFailed: "Não foi possível sincronizar uma ou mais fontes.",
  loading: "Carregando fontes…"
} as const;
