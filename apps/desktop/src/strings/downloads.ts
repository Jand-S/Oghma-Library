import type { JobStage } from "../core/types";

/** Labels for the downloads view and queue notifications, pt-BR. */
export const downloadsStrings = {
  // Toolbar
  pendingCount: (count: number) => (count === 1 ? "1 pendente" : `${count} pendentes`),
  queuePaused: "Fila pausada",
  pauseQueue: "Pausar fila",
  resumeQueue: "Retomar fila",
  clearCompleted: "Limpar concluídos",
  // Sections
  pendingHeading: "Em andamento",
  queuedHeading: "Na fila",
  queuedNote: "Os downloads são feitos um por vez.",
  queueListLabel: "Fila de downloads",
  completedHeading: "Concluídos",
  failedGroup: "Com falha",
  finishedGroup: "Finalizados",
  // Empty states
  emptyTitle: "Nenhum download",
  emptyDescription: "Escolha um livro em Buscar para começar.",
  goToDiscover: "Ir para Buscar",
  idleTitle: "Nada sendo baixado agora",
  idleDescription: "Escolha outro livro em Buscar para baixar.",
  pausedIdle: "A fila está pausada. Retome para continuar os downloads.",
  // Active card
  pause: "Pausar",
  resume: "Retomar",
  paused: "Pausado",
  cancel: "Cancelar",
  percentLabel: "Progresso",
  speed: "Velocidade",
  remaining: (eta: string) => `${eta} restantes`,
  remainingLabel: "Tempo restante",
  bytes: (received: string, total?: string) => (total ? `${received} de ${total}` : received),
  bytesLabel: "Recebido",
  chapters: (done: number, total: number) => `${done.toLocaleString("pt-BR")}/${total.toLocaleString("pt-BR")} capítulos`,
  chaptersLabel: "Capítulos",
  allChapters: (total: number) => `Todos os ${total.toLocaleString("pt-BR")} capítulos`,
  // Queue rows
  waiting: "Na fila",
  position: (position: number) => `${position}º`,
  positionLabel: (position: number) => `Posição ${position} na fila`,
  queueActions: (title: string) => `Ações de ${title}`,
  moveTop: "Mover para o topo",
  moveUpItem: "Subir",
  moveDownItem: "Descer",
  removeFromQueue: "Remover da fila",
  moveUp: (title: string) => `Subir ${title} na fila`,
  moveDown: (title: string) => `Descer ${title} na fila`,
  remove: (title: string) => `Remover ${title} da fila`,
  // Finished rows
  done: "Concluído",
  failedBadge: "Falhou",
  canceled: "Cancelado",
  failed: "Falha no download",
  retry: "Tentar de novo",
  retryLabel: (title: string) => `Tentar baixar ${title} de novo`,
  openFolder: "Abrir pasta",
  openFolderLabel: (title: string) => `Abrir pasta de ${title}`,
  removeFromList: (title: string) => `Remover ${title} da lista`,
  today: "Hoje",
  yesterday: "Ontem",
  audiobook: "Audiobook",
  translated: "Tradução",
  conversion: "Conversão",
  // Cancel confirmation
  cancelConfirmTitle: "Cancelar download?",
  cancelConfirmDescription: "Os arquivos parciais serão descartados.",
  cancelConfirm: "Cancelar download",
  keepDownloading: "Continuar baixando",
  // Toasts
  added: "Adicionado à fila",
  started: "Download iniciado",
  duplicate: "Este livro já está na fila",
  full: "A fila está cheia (máx. 10)",
  committed: (title: string) => `${title} salvo na biblioteca`,
  failedToast: (title: string, error?: string) => `Não foi possível baixar ${title}${error ? `: ${error}` : "."}`,
  canceledToast: (title: string) => `Download de ${title} cancelado.`,
  clearedToast: (count: number) => (count === 1 ? "1 item removido da lista." : `${count} itens removidos da lista.`),
  notInCatalog: "Livro não encontrado no catálogo",
  // Folder feedback
  folderLabel: (title: string) => `pasta de ${title}`,
  openingFolder: (label: string) => `Abrindo ${label}.`,
  folderInBrowser: (path: string) => `No navegador, use a pasta configurada: ${path}`,
  folderOpenFailed: (label: string) => `Não foi possível abrir ${label}.`
} as const;

/** Portuguese label for each job stage. */
export const stageLabels: Record<JobStage, string> = {
  waiting: "Na fila",
  preparing: "Preparando",
  fetching: "Baixando",
  building: "Montando capítulos",
  saving: "Salvando arquivos",
  converting: "Convertendo",
  committing: "Finalizando",
  done: "Concluído"
};
