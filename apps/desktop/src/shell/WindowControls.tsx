import { Copy, Minus, Square, X } from "lucide-react";
import { useEffect, useState, type MouseEvent } from "react";
import { runWindowAction, watchMaximized } from "../core/windowControls";
import { windowControlStrings } from "../strings/common";

const stopDrag = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation();

/** Minimize, maximize/restore and close buttons for the custom Windows/Linux title bar. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => watchMaximized(setMaximized), []);

  const maximizeLabel = maximized ? windowControlStrings.restore : windowControlStrings.maximize;

  return (
    <div className="o-window-controls" role="group" aria-label={windowControlStrings.group}>
      <button
        type="button"
        className="o-window-controls__button"
        aria-label={windowControlStrings.minimize}
        title={windowControlStrings.minimize}
        onMouseDown={stopDrag}
        onClick={() => void runWindowAction("minimize")}
      >
        <Minus aria-hidden="true" />
      </button>
      <button
        type="button"
        className="o-window-controls__button"
        aria-label={maximizeLabel}
        title={maximizeLabel}
        onMouseDown={stopDrag}
        onClick={() => void runWindowAction("maximize")}
      >
        {maximized ? <Copy aria-hidden="true" className="o-window-controls__restore" /> : <Square aria-hidden="true" />}
      </button>
      <button
        type="button"
        className="o-window-controls__button o-window-controls__button--close"
        aria-label={windowControlStrings.close}
        title={windowControlStrings.close}
        onMouseDown={stopDrag}
        onClick={() => void runWindowAction("close")}
      >
        <X aria-hidden="true" />
      </button>
    </div>
  );
}
