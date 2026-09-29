import type { TranslationEngine } from "../core/types";

export const statusLabel = {
  ongoing: "Em andamento",
  complete: "Completa",
  paused: "Pausada"
};

/** The config keys keep their historic ids ("deepl", "google"); the models behind them are DeepSeek and Gemini. */
export const translationEngineOptions: Array<{ value: TranslationEngine; label: string }> = [
  { value: "local", label: "Modelo local" },
  { value: "openai", label: "OpenAI" },
  { value: "deepl", label: "DeepSeek" },
  { value: "google", label: "Gemini" }
];

export type SetupSyncEntry = {
  progress: number;
  status: "pending" | "syncing" | "done" | "error";
  detail: string;
};
