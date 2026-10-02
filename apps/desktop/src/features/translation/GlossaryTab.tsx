import { AlertTriangle, BookA, Check, Eye, Pencil, Plus, RefreshCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type KeyboardEvent } from "react";
import type { GlossaryEntry, GlossaryKind, GlossarySuggestion, ProjectDetail } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, EmptyState, IconButton, SelectField, Spinner, TextField } from "../../ui";
import type { TranslationController } from "./useTranslationController";

const kindOptions: { value: GlossaryKind; label: string }[] = [
  { value: "keep", label: t.kindKeep },
  { value: "translate", label: t.kindTranslate }
];

type Draft = { term: string; kind: GlossaryKind; target: string };

/** Inline editor row, used both for "Adicionar termo" and for editing an entry. */
function EditRow({
  initial,
  isNew,
  saving,
  onSave,
  onCancel
}: {
  initial: Draft;
  isNew: boolean;
  saving: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<{ term?: string; target?: string }>({});

  const submit = async () => {
    const term = draft.term.trim();
    const target = draft.target.trim();
    const next: typeof error = {};
    if (!term) next.term = t.termRequired;
    if (draft.kind === "translate" && !target) next.target = t.targetRequired;
    setError(next);
    if (next.term || next.target) return;
    await onSave({ term, kind: draft.kind, target });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <tr className="translation-table__edit" data-testid="glossary-edit-row" onKeyDown={onKeyDown}>
      <th scope="row">
        {isNew ? (
          <TextField
            label={t.termField}
            hideLabel
            placeholder={t.termField}
            fieldClassName="o-field--sm"
            autoFocus
            value={draft.term}
            error={error.term}
            onChange={(event) => setDraft({ ...draft, term: event.target.value })}
          />
        ) : (
          <span className="translation-term">{draft.term}</span>
        )}
      </th>
      <td colSpan={3}>
        <div className="translation-term-edit">
          <SelectField<GlossaryKind>
            label={t.kindField}
            hideLabel
            fieldClassName="o-field--sm translation-term-edit__kind"
            options={kindOptions}
            value={draft.kind}
            onChange={(event) => setDraft({ ...draft, kind: event.target.value as GlossaryKind })}
          />
          {draft.kind === "translate" ? (
            <TextField
              label={t.targetField}
              hideLabel
              placeholder={t.targetField}
              fieldClassName="o-field--sm translation-term-edit__target"
              autoFocus={!isNew}
              value={draft.target}
              error={error.target}
              onChange={(event) => setDraft({ ...draft, target: event.target.value })}
            />
          ) : null}
        </div>
      </td>
      <td className="translation-table__actions">
        <IconButton size="sm" variant="primary" label={t.saveTerm} icon={<Check />} loading={saving} onClick={() => void submit()} />
        <IconButton size="sm" label={t.cancelEdit} icon={<X />} onClick={onCancel} />
      </td>
    </tr>
  );
}

function confidenceTone(value: number) {
  return value >= 80 ? "success" : "neutral";
}

/** Inline row under a term with the AI suggestion and accept/dismiss. */
function SuggestionRow({ suggestion, saving, onAccept, onDismiss }: {
  suggestion: GlossarySuggestion;
  saving: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <tr className="translation-table__suggestion" data-testid="glossary-suggestion" data-term={suggestion.term}>
      <td colSpan={5}>
        <div className="translation-suggestion">
          <Sparkles aria-hidden="true" className="translation-suggestion__icon" />
          <p className="translation-suggestion__text">
            <strong>{suggestion.kind === "translate" && suggestion.target ? t.suggestionTranslate(suggestion.target) : t.suggestionKeep}</strong>
            {suggestion.reason ? <span className="translation-suggestion__reason"> — {suggestion.reason}</span> : null}
          </p>
          <div className="translation-suggestion__actions">
            <Button size="sm" variant="primary" icon={<Check />} loading={saving} onClick={onAccept}>{t.acceptSuggestion}</Button>
            <Button size="sm" variant="ghost" onClick={onDismiss}>{t.dismissSuggestion}</Button>
          </div>
        </div>
      </td>
    </tr>
  );
}

/** Glossário: the auto-generated table, editable inline. */
export function GlossaryTab({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const entries = controller.glossary;
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const saving = controller.isBusy(`${project.id}:glossary`);
  const extracting = project.glossaryStatus === "running";
  const savedHideAt = project.glossaryHideAt ?? 80;
  const [hideAt, setHideAt] = useState(savedHideAt);
  const [showHidden, setShowHidden] = useState(false);
  // Terms saved or accepted in this visit stay listed (marked "Aprovado") so they don't vanish on save.
  const [touched, setTouched] = useState<Set<string>>(() => new Set());
  const touch = (term: string) => setTouched((current) => new Set(current).add(term));
  // Sync from the saved value only when switching projects, so a late save reply
  // never overrides what the user is dragging right now.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setHideAt(savedHideAt), [project.id]);
  /** Auto-approved: confident enough to leave the review list (still used in translation). */
  const isApproved = (entry: GlossaryEntry) => (entry.confidence ?? 100) >= hideAt;

  const hiddenCount = (entries ?? []).filter(isApproved).length;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(entries ?? [])]
      .filter((entry) => showHidden || (entry.confidence ?? 100) < hideAt || touched.has(entry.term))
      .filter((entry) => !needle || `${entry.term} ${entry.target ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  }, [entries, query, showHidden, hideAt, touched]);
  const suggestable = (entries ?? []).filter((entry) => !isApproved(entry));
  const suggestingAll = controller.isBusy(`${project.id}:suggest-all`);
  const commitHideAt = () => {
    if (hideAt !== savedHideAt) void controller.setHideAt(project.id, hideAt);
  };
  const missedCount = (entries ?? []).filter((entry) => entry.missed > 0).length;

  const save = async (draft: Draft) => {
    const ok = await controller.upsertTerm(project.id, {
      term: draft.term,
      kind: draft.kind,
      target: draft.kind === "translate" ? draft.target : undefined
    });
    if (ok) {
      touch(draft.term);
      setEditing(null);
      setAdding(false);
    }
    return ok;
  };

  const toDraft = (entry: GlossaryEntry): Draft => ({ term: entry.term, kind: entry.kind, target: entry.target ?? "" });
  const empty = entries !== undefined && entries.length === 0 && !adding;

  return (
    <div className="translation-glossary" data-testid="translation-glossary">
      <section className="translation-block" aria-labelledby="translation-glossary-title">
        <header className="translation-block__header">
          <div className="translation-block__heading translation-block__heading--inline">
            <h3 className="translation-block__title" id="translation-glossary-title" title={t.glossaryDescription}>{t.glossaryHeading}</h3>
            {entries && entries.length > 0 ? (
              <span className="translation-glossary__count">
                {t.glossaryCount(entries.length)}
                {missedCount > 0 ? (
                  <span className="translation-glossary__missed" title={t.missedSummary(missedCount)}>
                    <AlertTriangle aria-hidden="true" />
                    {t.missedSummary(missedCount)}
                  </span>
                ) : null}
              </span>
            ) : null}
          </div>
          <div className="translation-block__actions">
            {suggestable.length > 0 ? (
              <Button
                size="sm"
                variant="ghost"
                icon={<Sparkles />}
                title={t.suggestAllHint}
                loading={suggestingAll}
                disabled={!controller.loggedIn || extracting}
                onClick={() => void controller.suggestTerms(project.id, suggestable.map((entry) => entry.term))}
              >
                {t.suggestAll(suggestable.length)}
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="ghost"
              icon={<RefreshCcw />}
              title={t.regenerateHint}
              disabled={extracting || saving || !controller.loggedIn}
              onClick={() => void controller.regenerateGlossary(project.id)}
            >
              {t.regenerate}
            </Button>
            <Button
              size="sm"
              icon={<Plus />}
              disabled={adding}
              onClick={() => {
                setEditing(null);
                setAdding(true);
              }}
            >
              {t.addTerm}
            </Button>
          </div>
        </header>

        {extracting ? (
          <p className="translation-inline-status" role="status" data-testid="glossary-status">
            <Spinner size="sm" />
            {t.glossaryRunning}
          </p>
        ) : project.glossaryStatus === "error" ? (
          <p className="translation-inline-status translation-inline-status--danger" role="alert" data-testid="glossary-status">
            <AlertTriangle aria-hidden="true" />
            {t.glossaryError}
          </p>
        ) : null}

        {entries && entries.length > 0 ? (
          <div className="translation-glossary__filters">
            <label className="translation-confidence" title={t.hideAtHint}>
              <span className="translation-confidence__label">{t.hideAt}</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={hideAt}
                aria-label={t.hideAt}
                data-testid="glossary-min-confidence"
                onChange={(event) => setHideAt(Number(event.target.value))}
                onPointerUp={commitHideAt}
                onKeyUp={commitHideAt}
                onBlur={commitHideAt}
              />
              <span className="translation-confidence__value">{hideAt}%</span>
            </label>
            {hiddenCount > 0 ? (
              <span className="translation-glossary__hidden" data-testid="glossary-hidden">
                {t.hiddenTerms(hiddenCount, hideAt)}
                <Button size="sm" variant="ghost" icon={<Eye />} onClick={() => setShowHidden((value) => !value)}>
                  {showHidden ? t.hideHidden : t.showHidden}
                </Button>
              </span>
            ) : null}
          </div>
        ) : null}

        {entries && entries.length > 8 ? (
          <TextField
            label={t.glossarySearch}
            hideLabel
            placeholder={t.glossarySearch}
            leading={<Search />}
            fieldClassName="o-field--sm translation-glossary__search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        ) : null}

        {empty ? (
          <EmptyState
            className="translation-empty--compact"
            icon={<BookA />}
            title={t.glossaryEmptyTitle}
            description={`${t.glossaryDescription} ${t.glossaryEmptyDescription}`}
          />
        ) : entries === undefined ? null : (
          <div className="translation-table-wrap">
            <table className="translation-table translation-table--glossary" aria-label={t.glossaryTable}>
              <thead>
                <tr>
                  <th scope="col">{t.colTerm}</th>
                  <th scope="col">{t.colTarget}</th>
                  <th scope="col" className="is-num">{t.colConfidence}</th>
                  <th scope="col" className="is-num">{t.colCount}</th>
                  <th scope="col"><span className="sr-only">{t.colActions}</span></th>
                </tr>
              </thead>
              <tbody>
                {adding ? (
                  <EditRow
                    isNew
                    initial={{ term: "", kind: "translate", target: "" }}
                    saving={saving}
                    onSave={save}
                    onCancel={() => setAdding(false)}
                  />
                ) : null}
                {rows.map((entry) => (editing === entry.term ? (
                  <EditRow key={entry.term} isNew={false} initial={toDraft(entry)} saving={saving} onSave={save} onCancel={() => setEditing(null)} />
                ) : (
                  <Fragment key={entry.term}>
                  <tr data-testid="glossary-row" data-term={entry.term} className={isApproved(entry) ? "is-approved" : undefined}>
                    <th scope="row">
                      <span className="translation-term">
                        {entry.term}
                        <Badge tone={entry.source === "manual" ? "accent" : "neutral"} className={entry.source === "manual" ? "translation-term__source" : "translation-term__source is-auto"} title={t.colSource}>
                          {entry.source === "manual" ? t.sourceManual : t.sourceAuto}
                        </Badge>
                        {isApproved(entry) ? (
                          <Badge tone="success" className="translation-term__approved" title={t.hideAtHint}>
                            <Check aria-hidden="true" />
                            {t.approved}
                          </Badge>
                        ) : null}
                        {entry.missed > 0 ? (
                          <span className="translation-term__warn" title={t.missed(entry.missed)}>
                            <AlertTriangle aria-hidden="true" />
                            <span className="sr-only">{t.missed(entry.missed)}</span>
                          </span>
                        ) : null}
                      </span>
                    </th>
                    <td>
                      {entry.kind === "keep" ? (
                        <span className="translation-table__muted">{t.kindKeep}</span>
                      ) : (
                        <span className="translation-target">
                          <span className="translation-target__kind">{t.kindTranslate}</span>
                          {entry.target}
                        </span>
                      )}
                    </td>
                    <td className="is-num">
                      <Badge tone={confidenceTone(entry.confidence ?? 100)} title={t.confidenceTitle(entry.confidence ?? 100)} data-testid="glossary-confidence">
                        {entry.confidence ?? 100}%
                      </Badge>
                    </td>
                    <td className="is-num">{entry.count.toLocaleString("pt-BR")}</td>
                    <td className="translation-table__actions">
                      <IconButton
                        size="sm"
                        label={t.suggest(entry.term)}
                        icon={<Sparkles />}
                        loading={controller.isBusy(`${project.id}:suggest:${entry.term}`)}
                        disabled={!controller.loggedIn}
                        onClick={() => void controller.suggestTerms(project.id, [entry.term])}
                      />
                      <IconButton
                        size="sm"
                        label={t.editTerm(entry.term)}
                        icon={<Pencil />}
                        onClick={() => {
                          setAdding(false);
                          setEditing(entry.term);
                        }}
                      />
                      <IconButton size="sm" label={t.removeTerm(entry.term)} icon={<Trash2 />} disabled={saving} onClick={() => void controller.deleteTerm(project.id, entry.term)} />
                    </td>
                  </tr>
                  {controller.suggestions[entry.term] ? (
                    <SuggestionRow
                      suggestion={controller.suggestions[entry.term]}
                      saving={saving}
                      onAccept={() => {
                        touch(entry.term);
                        void controller.acceptSuggestion(project.id, controller.suggestions[entry.term]);
                      }}
                      onDismiss={() => controller.dismissSuggestion(project.id, entry.term)}
                    />
                  ) : null}
                  </Fragment>
                )))}
                {rows.length === 0 && !adding ? (
                  <tr>
                    <td colSpan={5} className="translation-table__muted" data-testid="glossary-all-reviewed">
                      {query.trim() ? t.glossaryNoMatch : t.reviewAllDone(hiddenCount)}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
