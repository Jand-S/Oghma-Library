import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Square,
  X
} from "lucide-react";
import { MouseEvent, useEffect, useState } from "react";
import { views } from "../constants/ui";
import type { ViewId } from "../core/types";
import { runWindowAction } from "../core/windowControls";

export function SplashScreen({ done }: { done: boolean }) {
  const [step, setStep] = useState(0);
  const labels = ["Inicializando UI", "Conectando backend mock", "Carregando catalogo", "Preparando fila"];

  useEffect(() => {
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, labels.length - 1)), 380);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={`splash-screen ${done ? "leaving" : ""}`}>
      <div className="splash-card">
        <img src="/icons/oghma-loop.svg" alt="Oghma Library" />
        <h1>Oghma Library</h1>
        <p>{labels[step]}</p>
        <div className="splash-progress">
          <span style={{ width: `${(step + 1) * 25}%` }} />
        </div>
      </div>
    </div>
  );
}

export function Titlebar({ title }: { title: string }) {
  const stopDrag = (event: MouseEvent<HTMLButtonElement>) => event.stopPropagation();

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span data-tauri-drag-region>{title}</span>
      </div>
      <div className="window-controls" aria-label="Controles da janela">
        <button onMouseDown={stopDrag} onClick={() => void runWindowAction("minimize")} aria-label="Minimizar">
          <Minus size={13} />
        </button>
        <button onMouseDown={stopDrag} onClick={() => void runWindowAction("maximize")} aria-label="Maximizar">
          <Square size={11} />
        </button>
        <button className="close" onMouseDown={stopDrag} onClick={() => void runWindowAction("close")} aria-label="Fechar">
          <X size={13} />
        </button>
      </div>
    </header>
  );
}

export function Sidebar({
  activeView,
  expanded,
  flashKey = 0,
  onToggle,
  onChange
}: {
  activeView: ViewId;
  expanded: boolean;
  flashKey?: number;
  onToggle: () => void;
  onChange: (view: ViewId) => void;
}) {
  const [flashing, setFlashing] = useState(false);
  useEffect(() => {
    if (flashKey === 0) return;
    setFlashing(true);
    const timer = window.setTimeout(() => setFlashing(false), 700);
    return () => window.clearTimeout(timer);
  }, [flashKey]);
  return (
    <aside className={`app-sidebar ${expanded ? "expanded" : ""}`}>
      <button className="brand-mark" onClick={onToggle} aria-label="Alternar menu lateral">
        <img src="/icons/oghma-icon.svg" alt="" />
        <span>Oghma</span>
      </button>
      <nav className="nav-stack" aria-label="Principal">
        {views.map((view) => {
          const Icon = view.icon;
          return (
            <button
              className={`nav-button ${activeView === view.id ? "active" : ""} ${flashing && view.id === "downloads" ? "flash" : ""}`}
              key={view.id}
              title={view.label}
              onClick={() => onChange(view.id)}
            >
              <Icon size={18} />
              <span>{view.label}</span>
            </button>
          );
        })}
      </nav>
      <button className="nav-button bottom-toggle" onClick={onToggle} title="Expandir menu">
        {expanded ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
        <span>Retrair</span>
      </button>
    </aside>
  );
}
