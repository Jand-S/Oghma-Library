import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { ViewId } from "../core/types";

/** Every routable view. "kindle" is shell-only for now (see viewRegistry). */
export type AppView = ViewId | "kindle";
export type NavParams = Record<string, string | number | boolean | undefined>;
export type NavEntry = { view: AppView; params: NavParams };

export type NavigateOptions = {
  /** Top-level navigation (sidebar): clears the back history. */
  root?: boolean;
  /** Replace the current entry instead of pushing one. */
  replace?: boolean;
};

export type NavigationValue = {
  view: AppView;
  params: NavParams;
  history: NavEntry[];
  canGoBack: boolean;
  navigate: (view: AppView, params?: NavParams, options?: NavigateOptions) => void;
  back: () => void;
};

const NavigationContext = createContext<NavigationValue | null>(null);

const MAX_HISTORY = 30;

type NavState = { current: NavEntry; history: NavEntry[] };

export function NavigationProvider({ initialView = "discover", children }: { initialView?: AppView; children: ReactNode }) {
  const [state, setState] = useState<NavState>({ current: { view: initialView, params: {} }, history: [] });

  const navigate = useCallback((view: AppView, params: NavParams = {}, options: NavigateOptions = {}) => {
    setState(({ current, history }) => {
      const next = { view, params };
      if (options.root) return { current: next, history: [] };
      if (options.replace) return { current: next, history };
      const same = current.view === view && JSON.stringify(current.params) === JSON.stringify(params);
      if (same) return { current, history };
      return { current: next, history: [...history, current].slice(-MAX_HISTORY) };
    });
  }, []);

  const back = useCallback(() => {
    setState(({ current, history }) => {
      if (history.length === 0) return { current, history };
      return { current: history[history.length - 1], history: history.slice(0, -1) };
    });
  }, []);

  const value = useMemo<NavigationValue>(() => ({
    view: state.current.view,
    params: state.current.params,
    history: state.history,
    canGoBack: state.history.length > 0,
    navigate,
    back
  }), [back, navigate, state]);

  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) throw new Error("useNavigation must be used inside <NavigationProvider>");
  return context;
}
