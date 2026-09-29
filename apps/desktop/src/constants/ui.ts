import type { IndexMode, TranslationEngine } from "../core/types";
import { onboardingStrings } from "../strings/onboarding";

export const statusLabel = {
  ongoing: "Em andamento",
  complete: "Completa",
  paused: "Pausada"
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
