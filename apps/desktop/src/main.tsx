import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { defaultAppConfig, readStoredConfig } from "./core/appConfig";
import type { BackendClient } from "./services/backendClient";
import { createStaticBackendClient } from "./services/staticBackend";
import "./styles/index.css";

function installInteractionGuards() {
  const block = (event: Event) => event.preventDefault();
  const blockKeyboard = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const hasPrimaryModifier = event.ctrlKey || event.metaKey;
    const blockedShortcut = hasPrimaryModifier && (
      key === "c"
      || key === "u"
      || key === "s"
      || (event.shiftKey && (key === "i" || key === "j" || key === "c"))
    );
    if (event.key === "F12" || blockedShortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  window.addEventListener("contextmenu", block, { capture: true });
  window.addEventListener("copy", block, { capture: true });
  window.addEventListener("cut", block, { capture: true });
  window.addEventListener("dragstart", block, { capture: true });
  window.addEventListener("selectstart", block, { capture: true });
  window.addEventListener("keydown", blockKeyboard, { capture: true });
}

function resolveBackend(): BackendClient {
  const stored = readStoredConfig();
  const serverUrl = stored?.serverUrl || defaultAppConfig().serverUrl;
  return createStaticBackendClient(serverUrl);
}

installInteractionGuards();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App backend={resolveBackend()} />
  </React.StrictMode>
);
