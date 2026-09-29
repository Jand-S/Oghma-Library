import type { JobStage } from "../core/types";

/** Labels for the downloads view and queue notifications, pt-BR. */
export const downloadsStrings = {
  clearCompleted: "Limpar",
  pendingHeading: "Em andamento",
  completedHeading: "Concluídos",
  itemCount: (count: number) => `${count} item(ns)`,
  pause: "Pausar",
  resume: "Retomar",
  paused: "Pausado",
  cancel: "Cancelar",
  noPending: "Nenhum download pendente.",
  noCompleted: "Nenhum download concluído.",
  waiting: "Na fila",
  moveUp: (title: string) => `Subir ${title} na fila`,
  moveDown: (title: string) => `Descer ${title} na fila`,
  remove: (title: string) => `Remover ${title} da fila`,
  retry: "Tentar de novo",
  retryLabel: (title: string) => `Tentar baixar ${title} de novo`,
  openFolder: "Abrir pasta",
  openFolderLabel: (title: string) => `Abrir pasta de ${title}`,
  failed: "Falha no download",
  canceled: "Cancelado",
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
  clearedToast: (count: number) => `${count} item(ns) removido(s) da lista.`,
  notInCatalog: "Livro não encontrado no catálogo"
} as const;

/** Portuguese label for each job stage. */
export const stageLabels: Record<JobStage, string> = {
  waiting: "Na fila",
  preparing: "Preparando",
  fetching: "Baixando",
  building: "Montando",
  saving: "Salvando",
  converting: "Convertendo",
  committing: "Finalizando",
  done: "Concluído"
};
