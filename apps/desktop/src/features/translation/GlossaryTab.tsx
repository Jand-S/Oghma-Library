import { AlertTriangle, BookA, Check, Pencil, Plus, RefreshCcw, Search, Sparkles, Trash2, X } from "lucide-react";
import { Fragment, useMemo, useState, type KeyboardEvent } from "react";
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
      <td colSpan={2}>
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

/** Inline row under a term with the AI suggestion and accept/dismiss. */
function SuggestionRow({ suggestion, saving, onAccept, onDismiss }: {
  suggestion: GlossarySuggestion;
  saving: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  return (
    <tr className="translation-table__suggestion" data-testid="glossary-suggestion" data-term={suggestion.term}>
      <td colSpan={4}>
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

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [...(entries ?? [])]
      .filter((entry) => !needle || `${entry.term} ${entry.target ?? ""}`.toLowerCase().includes(needle))
      .sort((a, b) => b.count - a.count || a.term.localeCompare(b.term));
  }, [entries, query]);
  // Batch suggestions for automatic terms still kept untranslated (the backend caps one call at 40).
  const suggestable = (entries ?? []).filter((entry) => entry.source === "auto" && entry.kind === "keep").slice(0, 40);
  const suggestingAll = controller.isBusy(`${project.id}:suggest-all`);
  const missedCount = (entries ?? []).filter((entry) => entry.missed > 0).length;

  const save = async (draft: Draft) => {
    const ok = await controller.upsertTerm(project.id, {
      term: draft.term,
      kind: draft.kind,
      target: draft.kind === "translate" ? draft.target : undefined
    });
    if (ok) {
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
                  <tr data-testid="glossary-row" data-term={entry.term}>
                    <th scope="row">
                      <span className="translation-term">
                        {entry.term}
                        <Badge tone={entry.source === "manual" ? "accent" : "neutral"} className={entry.source === "manual" ? "translation-term__source" : "translation-term__source is-auto"} title={t.colSource}>
                          {entry.source === "manual" ? t.sourceManual : t.sourceAuto}
                        </Badge>
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
                      onAccept={() => void controller.acceptSuggestion(project.id, controller.suggestions[entry.term])}
                      onDismiss={() => controller.dismissSuggestion(project.id, entry.term)}
                    />
                  ) : null}
                  </Fragment>
                )))}
                {rows.length === 0 && !adding ? (
                  <tr>
                    <td colSpan={4} className="translation-table__muted">{t.glossaryNoMatch}</td>
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
