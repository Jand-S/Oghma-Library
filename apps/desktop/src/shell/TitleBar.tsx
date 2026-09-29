import { shellStrings } from "../strings/common";
import { WindowControls } from "./WindowControls";
import "./TitleBar.css";

/** Custom 35px title bar for Windows and Linux (macOS uses native traffic lights). */
export function TitleBar({ title = shellStrings.appName }: { title?: string }) {
  return (
    <header className="o-titlebar o-app__titlebar" data-testid="titlebar" data-tauri-drag-region>
      <div className="o-titlebar__brand" data-tauri-drag-region>
        <img className="o-titlebar__logo" src="/icons/oghma-icon.svg" alt="" draggable={false} data-tauri-drag-region />
        <span data-tauri-drag-region>{title}</span>
      </div>
      <WindowControls />
    </header>
  );
}
