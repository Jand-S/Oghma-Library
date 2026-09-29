import type { AppConfig, LibraryItem } from "../../core/types";
import type { BackendClient } from "../../services/backendClient";

type TranslationControllerArgs = {
  backend: BackendClient;
  library: LibraryItem[];
  config: AppConfig;
  onConfigChange: (patch: Partial<AppConfig>) => void;
  onOpenItemFolder: (item: LibraryItem) => void;
  notify: (message: string) => void;
};

/**
 * Wiring for the Translation view. The view still owns its job state; this
 * is the seam where that logic moves in a later phase.
 */
export function useTranslationController({ backend, library, config, onConfigChange, onOpenItemFolder, notify }: TranslationControllerArgs) {
  return { backend, library, config, onConfigChange, onOpenItemFolder, onNotify: notify };
}

export type TranslationController = ReturnType<typeof useTranslationController>;
