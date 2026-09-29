import { useEffect, useMemo, useState } from "react";
import type {
  TranslationMemoryConflict,
  TranslationMemoryConflictSuggestion,
  TranslationMemoryTerm,
  TranslationSelectionRecord
} from "../../core/types";
import { getErrorMessage } from "../../services/backendClient";
import { translationStrings } from "../../strings/translation";
import { conflictKey } from "./translationModel";
import type { TranslationController } from "./useTranslationController";

const MAX_MEMORY_TERMS = 5;
const MAX_ALERTS = 3;

export type GlossaryAlert = {
  key: string;
  conflict: TranslationMemoryConflict | null;
  suggestion: TranslationMemoryConflictSuggestion | null;
};

function upsertTerm(items: TranslationMemoryTerm[], term: TranslationMemoryTerm) {
  return [term, ...items.filter((item) => item.source.toLowerCase() !== term.source.toLowerCase())].slice(0, MAX_MEMORY_TERMS);
}

/**
 * Page-scoped translation memory of the selected project: automatic terms,
 * conflict alerts with their suggestions and the automatic-model history.
 * Manual terms are kept by the controller and also saved to the memory here.
 */
export function useTranslationMemory(controller: TranslationController) {
  const { backend, config, selectedKey, settings, notify, addGlossaryTerm } = controller;
  const [selectionHistory, setSelectionHistory] = useState<TranslationSelectionRecord[]>([]);
  const [memoryTerms, setMemoryTerms] = useState<TranslationMemoryTerm[]>([]);
  const [conflicts, setConflicts] = useState<TranslationMemoryConflict[]>([]);
  const [suggestions, setSuggestions] = useState<TranslationMemoryConflictSuggestion[]>([]);
  const [resolving, setResolving] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const clear = () => {
      setSelectionHistory([]);
      setMemoryTerms([]);
      setConflicts([]);
      setSuggestions([]);
    };
    if (!selectedKey) {
      clear();
      return;
    }
    let cancelled = false;
    void Promise.all([
      backend.getTranslationSelectionHistory(selectedKey),
      backend.getTranslationMemory(selectedKey),
      backend.getTranslationMemoryConflicts(selectedKey),
      backend.getTranslationMemoryConflictSuggestions(selectedKey)
    ])
      .then(([records, terms, conflictList, suggestionList]) => {
        if (cancelled) return;
        setSelectionHistory(records.slice(0, 3));
        setMemoryTerms(terms.slice(0, MAX_MEMORY_TERMS));
        setConflicts(conflictList.slice(0, MAX_ALERTS));
        setSuggestions(suggestionList.slice(0, MAX_ALERTS));
      })
      .catch(() => {
        if (!cancelled) clear();
      });
    return () => {
      cancelled = true;
    };
  }, [backend, selectedKey]);

  // Conflicts with their matching suggestion, plus suggestions that match no listed conflict.
  const alerts = useMemo<GlossaryAlert[]>(() => {
    const byKey = new Map(suggestions.map((item) => [conflictKey(item.source, item.relatedSource, item.conflictType), item]));
    const fromConflicts = conflicts.map((conflict) => {
      const key = conflictKey(conflict.source, conflict.relatedSource, conflict.conflictType);
      const suggestion = byKey.get(key) ?? null;
      byKey.delete(key);
      return { key, conflict, suggestion };
    });
    const orphans = [...byKey.entries()].map(([key, suggestion]) => ({ key, conflict: null, suggestion }));
    return [...fromConflicts, ...orphans];
  }, [conflicts, suggestions]);

  const addTerm = (source: string, target: string) => {
    if (!selectedKey) return;
    addGlossaryTerm(selectedKey, source, target);
    void backend.upsertTranslationMemoryTerm({
      novelId: selectedKey,
      source,
      target,
      targetLanguage: config.targetLanguage,
      status: "locked",
      category: "manual",
      notes: translationStrings.manualNote,
      applyExisting: settings.applyGlossaryToExisting
    })
      .then((payload) => {
        setMemoryTerms((items) => upsertTerm(items, payload.term));
        if (payload.postEdit) notify(translationStrings.termSaved(payload.postEdit.changedCount, payload.postEdit.skippedCount));
      })
      .catch(() => undefined);
  };

  const applySuggestion = (suggestion: TranslationMemoryConflictSuggestion) => {
    if (suggestion.action === "review_only") return;
    const key = conflictKey(suggestion.source, suggestion.relatedSource, suggestion.conflictType);
    setResolving((items) => new Set(items).add(key));
    void backend.resolveTranslationMemoryConflict({
      novelId: suggestion.novelId,
      source: suggestion.source,
      target: suggestion.suggestedTarget,
      targetLanguage: config.targetLanguage,
      applyExisting: settings.applyGlossaryToExisting
    })
      .then((payload) => {
        const isResolved = (item: { source: string; relatedSource: string; conflictType: string }) =>
          conflictKey(item.source, item.relatedSource, item.conflictType) === key;
        setMemoryTerms((items) => upsertTerm(items, payload.term));
        setConflicts((items) => items.filter((item) => !isResolved(item)));
        setSuggestions((items) => items.filter((item) => !isResolved(item)));
        const postEdit = payload.postEdit
          ? ` ${translationStrings.termSaved(payload.postEdit.changedCount, payload.postEdit.skippedCount)}`
          : "";
        notify(`${translationStrings.suggestionApplied(payload.remainingConflictCount)}${postEdit}`);
      })
      .catch((error: unknown) => notify(getErrorMessage(error, translationStrings.suggestionFailed)))
      .finally(() => {
        setResolving((items) => {
          const next = new Set(items);
          next.delete(key);
          return next;
        });
      });
  };

  return { selectionHistory, memoryTerms, alerts, resolving, addTerm, applySuggestion };
}

export type TranslationMemory = ReturnType<typeof useTranslationMemory>;
