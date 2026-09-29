import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { uiStrings } from "../strings/common";
import { cx } from "./cx";
import "./Toast.css";

export type ToastTone = "info" | "success" | "warning" | "danger";

export type ToastOptions = {
  message: ReactNode;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** Milliseconds before auto-dismiss. 0 keeps the toast until dismissed. Default 4000. */
  duration?: number;
};

type ToastEntry = Required<Pick<ToastOptions, "tone" | "duration">> & ToastOptions & { id: number };

type ToastContextValue = {
  toast: (options: ToastOptions | string) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const MAX_VISIBLE = 3;
export const DEFAULT_TOAST_DURATION = 4000;

const icons: Record<ToastTone, ReactNode> = {
  info: <Info />,
  success: <CheckCircle2 />,
  warning: <AlertTriangle />,
  danger: <XCircle />
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const toast = useCallback((options: ToastOptions | string) => {
    const normalized = typeof options === "string" ? { message: options } : options;
    const id = nextId.current;
    nextId.current += 1;
    const entry: ToastEntry = { tone: "info", duration: DEFAULT_TOAST_DURATION, ...normalized, id };
    setToasts((current) => [...current, entry].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [dismiss, toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section className="o-toast-region" aria-label={uiStrings.notifications}>
        {toasts.map((entry) => (
          <ToastItem key={entry.id} entry={entry} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext.Provider>
  );
}

function ToastItem({ entry, onDismiss }: { entry: ToastEntry; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(entry.duration);
  const startedAt = useRef(0);

  useEffect(() => {
    if (entry.duration <= 0 || paused) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => onDismiss(entry.id), remaining.current);
    return () => {
      window.clearTimeout(timer);
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current));
    };
  }, [entry.duration, entry.id, onDismiss, paused]);

  const urgent = entry.tone === "danger";
  return (
    <div
      className={cx("o-toast", `o-toast--${entry.tone}`)}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="o-toast__content">
        <span className="o-toast__icon" aria-hidden="true">{icons[entry.tone]}</span>
        <div className="o-toast__message">{entry.message}</div>
        {entry.action ? (
          <button
            type="button"
            className="o-toast__action"
            onClick={() => {
              entry.action?.onClick();
              onDismiss(entry.id);
            }}
          >
            {entry.action.label}
          </button>
        ) : null}
        <button type="button" className="o-toast__close" aria-label={uiStrings.dismissToast} onClick={() => onDismiss(entry.id)}>
          <X aria-hidden="true" />
        </button>
      </div>
      {entry.duration > 0 ? (
        <span
          className="o-toast__countdown"
          aria-hidden="true"
          style={{ animationDuration: `${entry.duration}ms`, animationPlayState: paused ? "paused" : "running" }}
        />
      ) : null}
    </div>
  );
}

/** Access the app toaster. Must be used under <ToastProvider>. */
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used inside <ToastProvider>");
  return context;
}
