import { useCallback, useEffect, useRef, useState } from "react";
import {
  forgetRequest,
  listSourceRequests,
  requestSource,
  type NewSourceRequest,
  type SourceRequest
} from "../../services/sourceRequests";

export const SOURCE_REQUESTS_REFRESH_MS = 60_000;

type Deps = {
  list?: () => Promise<SourceRequest[]>;
  create?: (input: NewSourceRequest) => Promise<SourceRequest>;
  refreshMs?: number;
};

/** Pedidos de fonte nova mostrados na tela Fontes; atualiza sozinho enquanto a tela está aberta. */
export function useSourceRequests({ list = listSourceRequests, create = requestSource, refreshMs = SOURCE_REQUESTS_REFRESH_MS }: Deps = {}) {
  const [requests, setRequests] = useState<SourceRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const items = await list();
      if (!alive.current) return;
      setRequests(items);
      setError(null);
    } catch (err) {
      // Sem rede ou brain fora: a tela segue com as fontes normais.
      if (alive.current) setError(err instanceof Error ? err.message : String(err));
    }
  }, [list]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh, refreshMs]);

  const submit = useCallback(async (input: NewSourceRequest) => {
    const created = await create(input);
    setRequests((items) => [...items.filter((item) => item.id !== created.id), created]);
    return created;
  }, [create]);

  const dismiss = useCallback((id: string) => {
    forgetRequest(id);
    setRequests((items) => items.filter((item) => item.id !== id));
  }, []);

  return { requests, error, refresh, submit, dismiss };
}
