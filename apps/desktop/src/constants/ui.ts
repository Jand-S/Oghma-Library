import {
  Download,
  Globe2,
  Home,
  Languages,
  Library,
  Settings
} from "lucide-react";
import type { IndexMode, TranslationEngine, ViewId } from "../core/types";
import { navStrings } from "../strings/common";
import { onboardingStrings } from "../strings/onboarding";

export const tags = ["Fantasia", "Romance", "Misterio", "Isekai", "Aventura", "Drama"];

export const views: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "discover", label: navStrings.discover, icon: Home },
  { id: "sources", label: navStrings.sources, icon: Globe2 },
  { id: "downloads", label: navStrings.downloads, icon: Download },
  { id: "library", label: navStrings.library, icon: Library },
  { id: "translation", label: navStrings.translation, icon: Languages },
  { id: "settings", label: navStrings.settings, icon: Settings }
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
  translation: "Central de traducao",
  settings: "Ajustes"
};

export const onboardingSteps: string[] = [...onboardingStrings.steps];

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
