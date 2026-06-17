import { Download, Globe2, Home, Library, Settings } from "lucide-react";
import type { IndexMode, TranslationEngine, ViewId } from "../types";

export const tags = ["Fantasia", "Romance", "Misterio", "Isekai", "Aventura", "Drama"];

export const views: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "discover", label: "Buscar", icon: Home },
  { id: "sources", label: "Fontes", icon: Globe2 },
  { id: "downloads", label: "Downloads", icon: Download },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "settings", label: "Ajustes", icon: Settings }
];

export const statusLabel = {
  ongoing: "Em andamento",
  complete: "Completa",
  paused: "Pausada"
};

export const pageTitle: Record<ViewId, string> = {
  discover: "Download Search",
  sources: "Selecao de sites",
  downloads: "Fila de downloads",
  library: "Biblioteca local",
  settings: "Ajustes"
};

export const onboardingSteps = ["Bem-vindo", "Servidor", "Saida", "Fontes", "Preferencias", "Resumo", "Sincronizacao"];

export const indexModeOptions: Array<{ value: IndexMode; label: string; description: string }> = [
  { value: "incremental_recent", label: "Incremental", description: "Atualiza novidades e preserva o catalogo sem recrawlar tudo." },
  { value: "catalog_only", label: "Somente catalogo", description: "Baixa apenas metadados e index de capitulos." },
  { value: "guarded_refresh", label: "Varredura protegida", description: "Revalida fontes com mais cuidado e menor ritmo." }
];

export const translationEngineOptions: Array<{ value: TranslationEngine; label: string }> = [
  { value: "local", label: "Modelo local" },
  { value: "openai", label: "OpenAI" },
  { value: "deepl", label: "DeepL" },
  { value: "google", label: "Google Translate" }
];

export type SetupSyncEntry = {
  progress: number;
  status: "pending" | "syncing" | "done" | "error";
  detail: string;
};
