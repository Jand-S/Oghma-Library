import { useEffect, useRef, useState } from "react";
import type { Filters, Novel } from "../core/types";
import { getErrorMessage, type BackendClient } from "../services/backendClient";

type NovelSearchArgs = {
  backend: BackendClient;
  filters: Filters;
  focusedNovelId: string;
  loading: boolean;
  setFocusedNovelId: (id: string) => void;
  setResults: (items: Novel[]) => void;
  setToast: (message: string) => void;
};

export function useNovelSearch({
  backend,
  filters,
  focusedNovelId,
  loading,
  setFocusedNovelId,
  setResults,
  setToast
}: NovelSearchArgs) {
  const [searching, setSearching] = useState(false);
  const skippedInitialSearch = useRef(false);
  const focusedNovelIdRef = useRef(focusedNovelId);

  useEffect(() => {
    focusedNovelIdRef.current = focusedNovelId;
  }, [focusedNovelId]);

  useEffect(() => {
    if (loading || filters.sourceId === "all") return;
    if (!skippedInitialSearch.current) {
      skippedInitialSearch.current = true;
      return;
    }
    let cancelled = false;
    setSearching(true);

    void backend.searchNovels(filters)
      .then((items) => {
        if (cancelled) return;
        setResults(items);
        if (items.length > 0 && !items.some((item) => item.id === focusedNovelIdRef.current)) {
          setFocusedNovelId(items[0].id);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setToast(getErrorMessage(error, "Não foi possível atualizar os resultados da busca."));
      })
      .finally(() => {
        if (cancelled) return;
        setSearching(false);
      });

    return () => {
      cancelled = true;
    };
  }, [backend, filters, loading, setFocusedNovelId, setResults, setToast]);

  return searching;
}
