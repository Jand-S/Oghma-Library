import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { defaultAppConfig, readStoredConfig } from "./core/appConfig";
import type { BackendClient } from "./services/backendClient";
import { createStaticBackendClient } from "./services/staticBackend";
import "./styles/index.css";

function resolveBackend(): BackendClient {
  const stored = readStoredConfig();
  const serverUrl = stored?.serverUrl || defaultAppConfig().serverUrl;
  return createStaticBackendClient(serverUrl);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App backend={resolveBackend()} />
  </React.StrictMode>
);
