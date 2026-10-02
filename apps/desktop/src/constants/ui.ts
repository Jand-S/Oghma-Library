export const statusLabel = {
  ongoing: "Em andamento",
  complete: "Completa",
  paused: "Pausada"
};

export type SetupSyncEntry = {
  progress: number;
  status: "pending" | "syncing" | "done" | "error";
  detail: string;
};
