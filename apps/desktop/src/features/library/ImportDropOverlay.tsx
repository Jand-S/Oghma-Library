import { FileUp } from "lucide-react";
import { createPortal } from "react-dom";
import { importEpubStrings as strings } from "../../strings/importEpub";
import "./importSheet.css";

/**
 * "Solte para importar": covers the whole window while .epub files are dragged over it (any
 * page). It never takes the pointer; the drop itself goes through Tauri and opens the preview.
 */
export function ImportDropOverlay({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return createPortal(
    <div className="library-drop" data-testid="import-drop-overlay" role="status" aria-live="polite">
      <div className="library-drop__panel">
        <span className="library-drop__icon" aria-hidden="true"><FileUp /></span>
        <strong className="library-drop__title">{strings.dropTitle}</strong>
        <span className="library-drop__hint">{strings.dropHint}</span>
      </div>
    </div>,
    document.body
  );
}
