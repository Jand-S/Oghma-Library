import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { defaultAppConfig, readStoredConfig } from "./appConfig";
import { mockBackendClient } from "./mockBackend";
import { createStaticBackendClient } from "./services/staticBackend";
import type { BackendClient } from "./services/backendClient";
import "./styles/index.css";

// Escolhe o backend real conforme o serverUrl configurado.
// - VITE_USE_MOCK=1 (ou serverUrl vazio) -> backend mock para desenvolvimento.
// - caso contrario -> cliente estatico que le o acervo publicado no B2/CDN.
function resolveBackend(): BackendClient {
  const useMock = (import.meta as { env?: Record<string, string> }).env?.VITE_USE_MOCK === "1";
  if (useMock) return mockBackendClient;
  const stored = readStoredConfig();
  const serverUrl = stored?.serverUrl || defaultAppConfig().serverUrl;
  if (!serverUrl) return mockBackendClient;
  return createStaticBackendClient(serverUrl);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App backend={resolveBackend()} />
  </React.StrictMode>
);
