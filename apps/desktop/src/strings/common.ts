/**
 * User-facing labels shared across views (pt-BR).
 *
 * Views render these constants and tests query by them, so copy can change in
 * one place without breaking the suite.
 */
export const windowControlStrings = {
  group: "Controles da janela",
  minimize: "Minimizar",
  maximize: "Maximizar",
  restore: "Restaurar",
  close: "Fechar"
} as const;

export const navStrings = {
  home: "Início",
  discover: "Buscar",
  sources: "Fontes",
  downloads: "Downloads",
  library: "Biblioteca",
  translation: "Tradução",
  kindle: "Kindle",
  settings: "Ajustes"
} as const;

/** Page titles shown in the page header, per view. */
export const pageTitleStrings = {
  home: "Início",
  discover: "Buscar novels",
  sources: "Fontes",
  downloads: "Downloads",
  library: "Biblioteca",
  kindle: "Kindle",
  translation: "Tradução",
  settings: "Ajustes"
} as const;

export const shellStrings = {
  appName: "Oghma Library",
  mainNav: "Principal",
  collapseSidebar: "Recolher menu",
  expandSidebar: "Expandir menu",
  resizeSidebar: "Redimensionar menu lateral",
  back: "Voltar",
  downloadsActive: "Download em andamento",
  idle: "Nenhum download em andamento",
  queued: (count: number) => `${count} na fila`,
  downloading: (title: string) => `Baixando ${title}…`,
  openDownloads: "Abrir downloads",
  bootErrorTitle: "Não foi possível carregar o acervo",
  bootErrorDescription:
    "O app não conseguiu falar com o servidor de índice configurado. Ajuste o endereço do servidor em Ajustes e rode o assistente inicial novamente.",
  retry: "Tentar novamente",
  openSettings: "Abrir Ajustes"
} as const;

export const bootStrings = {
  config: "Lendo configurações",
  server: "Conectando ao servidor de índice",
  catalog: "Carregando catálogo e biblioteca",
  ready: "Tudo pronto",
  failed: "Não foi possível conectar"
} as const;

/** Labels used by the src/ui primitives. */
export const uiStrings = {
  close: "Fechar",
  cancel: "Cancelar",
  confirm: "Confirmar",
  loading: "Carregando",
  notifications: "Notificações",
  dismissToast: "Dispensar notificação",
  remove: (label: string) => `Remover ${label}`,
  dragHandle: (label: string) => `Reordenar ${label}. Use Alt + seta para cima ou para baixo.`,
  moved: (label: string, position: number, total: number) => `${label} movido para a posição ${position} de ${total}.`,
  moreActions: "Mais ações"
} as const;

export const kindleStrings = {
  connected: "Kindle conectado",
  disconnected: "Kindle desconectado",
  shortConnected: "conectado",
  shortDisconnected: "desconectado"
} as const;
