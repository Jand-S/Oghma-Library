import type { TranslationController } from "../features/translation/useTranslationController";

/**
 * The ChatGPT account ("Sign in with ChatGPT"), shared by Tradução, the Buscar AI
 * suggestions and Ajustes > Conta. The state lives in the app-wide translation
 * controller (it listens to `translation://account`); this is its account slice,
 * so every screen reads one source of truth.
 */
export type AccountController = Pick<
  TranslationController,
  "available" | "account" | "loggedIn" | "connecting" | "connect" | "cancelConnect" | "logout" | "openUsagePage" | "usage" | "isBusy"
>;

export function accountOf(translation: TranslationController): AccountController {
  const { available, account, loggedIn, connecting, connect, cancelConnect, logout, openUsagePage, usage, isBusy } = translation;
  return { available, account, loggedIn, connecting, connect, cancelConnect, logout, openUsagePage, usage, isBusy };
}
