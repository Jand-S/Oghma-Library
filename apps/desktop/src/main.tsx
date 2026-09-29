/// <reference types="vite/client" />
// Styles first: index.css declares the cascade layer order before any component CSS.
import "./styles/index.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { defaultAppConfig, readStoredConfig } from "./core/appConfig";
import type { BackendClient } from "./services/backendClient";
import { createStaticBackendClient } from "./services/staticBackend";
import { applyPlatform, watchFullscreen } from "./shell/platform";

/** True for inputs, textareas and contenteditable regions, where selection, copy and the context menu must keep working. */
function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, [contenteditable]:not([contenteditable='false']), .is-selectable"));
}

function installInteractionGuards() {
  const blockOutsideEditable = (event: Event) => {
    const target = event.type === "selectstart" && event.target instanceof Node && !(event.target instanceof Element)
      ? event.target.parentElement
      : event.target;
    if (!isEditableTarget(target)) event.preventDefault();
  };
  const blockKeyboard = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    const hasPrimaryModifier = event.ctrlKey || event.metaKey;
    const devtoolsShortcut = hasPrimaryModifier && event.shiftKey && (key === "i" || key === "j" || key === "c");
    // Copy stays available inside editable fields; view-source and save-page are always blocked.
    const blockedShortcut = hasPrimaryModifier && (
      key === "u"
      || key === "s"
      || (key === "c" && !event.shiftKey && !isEditableTarget(event.target))
    );
    if (event.key === "F12" || devtoolsShortcut || blockedShortcut) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  window.addEventListener("contextmenu", blockOutsideEditable, { capture: true });
  window.addEventListener("copy", blockOutsideEditable, { capture: true });
  window.addEventListener("cut", blockOutsideEditable, { capture: true });
  window.addEventListener("selectstart", blockOutsideEditable, { capture: true });
  window.addEventListener("dragstart", (event) => event.preventDefault(), { capture: true });
  window.addEventListener("keydown", blockKeyboard, { capture: true });
}

function resolveBackend(): BackendClient {
  const stored = readStoredConfig();
  const serverUrl = stored?.serverUrl || defaultAppConfig().serverUrl;
  return createStaticBackendClient(serverUrl);
}

watchFullscreen(applyPlatform());
installInteractionGuards();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

async function render() {
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("gallery")) {
    const { Gallery } = await import("./dev/Gallery");
    root.render(<React.StrictMode><Gallery /></React.StrictMode>);
    return;
  }
  root.render(
    <React.StrictMode>
      <App backend={resolveBackend()} />
    </React.StrictMode>
  );
}

void render();
