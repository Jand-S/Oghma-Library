import { AlertTriangle, BookA, Check, Plus, Sparkles, Trash2 } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, EmptyState, IconButton, Section, Switch, TextField, type BadgeTone } from "../../ui";
import type { TranslationController } from "./useTranslationController";
import type { TranslationMemory } from "./useTranslationMemory";

const severityTone: Record<string, BadgeTone> = { high: "danger", medium: "warning", low: "neutral" };

function GroupHeader({ icon, title, count, description }: { icon: ReactNode; title: string; count: number; description?: string }) {
  return (
    <div className="translation-group__header">
      <span className="translation-group__icon" aria-hidden="true">{icon}</span>
      <h3 className="translation-group__title">{title}</h3>
      <Badge>{count}</Badge>
      {description ? <p className="translation-group__description">{description}</p> : null}
    </div>
  );
}

export function GlossaryTab({ controller, memory }: { controller: TranslationController; memory: TranslationMemory }) {
  const [source, setSource] = useState("");
  const [target, setTarget] = useState("");
  const sourceRef = useRef<HTMLInputElement>(null);
  const { glossaryTerms, selectedKey, settings, patchSettings, removeGlossaryTerm } = controller;
  const canAdd = source.trim().length > 0 && target.trim().length > 0;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canAdd) return;
    memory.addTerm(source.trim(), target.trim());
    setSource("");
    setTarget("");
    sourceRef.current?.focus();
  };

  return (
    <Section className="translation-tab" title={t.glossaryHeading} description={t.glossaryDescription}>
      <form className="translation-glossary-form" onSubmit={submit}>
        <div className="translation-glossary-form__row">
          <TextField ref={sourceRef} label={t.termSource} value={source} onChange={(event) => setSource(event.target.value)} />
          <TextField label={t.termTarget} value={target} onChange={(event) => setTarget(event.target.value)} />
          <Button type="submit" icon={<Plus />} disabled={!canAdd}>{t.addTerm}</Button>
        </div>
        <Switch
          label={t.applyExisting}
          description={t.applyExistingDescription}
          checked={settings.applyGlossaryToExisting}
          onChange={(checked) => patchSettings({ applyGlossaryToExisting: checked })}
        />
      </form>

      <div className="translation-group">
        <GroupHeader icon={<BookA />} title={t.manualTerms} count={glossaryTerms.length} />
        {glossaryTerms.length === 0 ? (
          <EmptyState
            className="translation-empty--compact"
            icon={<BookA />}
            title={t.emptyGlossaryTitle}
            description={t.emptyGlossaryDescription}
            action={<Button size="sm" icon={<Plus />} onClick={() => sourceRef.current?.focus()}>{t.emptyGlossaryAction}</Button>}
          />
        ) : (
          <ul className="translation-terms" aria-label={t.manualTerms}>
            {glossaryTerms.map((term) => (
              <li className="translation-term" key={term.id} data-testid="translation-term">
                <span className="translation-term__pair">
                  <strong>{term.source}</strong>
                  <span aria-hidden="true">→</span>
                  <span>{term.target}</span>
                </span>
                <span className="translation-term__note">{term.note}</span>
                <IconButton size="sm" label={t.removeTerm(term.source)} icon={<Trash2 />} onClick={() => removeGlossaryTerm(selectedKey, term.id)} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {memory.memoryTerms.length ? (
        <div className="translation-group">
          <GroupHeader icon={<Sparkles />} title={t.memoryTerms} count={memory.memoryTerms.length} description={t.memoryTermsDescription} />
          <ul className="translation-terms" aria-label={t.memoryTerms}>
            {memory.memoryTerms.map((term) => (
              <li className="translation-term" key={`${term.source}-${term.target}`}>
                <span className="translation-term__pair">
                  <strong>{term.source}</strong>
                  <span aria-hidden="true">→</span>
                  <span>{term.target}</span>
                </span>
                <span className="translation-term__note">
                  {t.termStatus[term.status] ?? term.status} · {t.termUses(term.occurrences)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {memory.alerts.length ? (
        <div className="translation-group">
          <GroupHeader icon={<AlertTriangle />} title={t.alerts} count={memory.alerts.length} description={t.alertsDescription} />
          <ul className="translation-terms" aria-label={t.alerts}>
            {memory.alerts.map(({ key, conflict, suggestion }) => {
              const canApply = Boolean(suggestion && suggestion.action !== "review_only");
              const severity = conflict?.severity ?? suggestion?.severity ?? "low";
              const pair = conflict
                ? `${conflict.source} / ${conflict.relatedSource}`
                : suggestion ? `${suggestion.source} / ${suggestion.relatedSource}` : "";
              const detail = suggestion && canApply
                ? t.suggested(suggestion.source, suggestion.suggestedTarget)
                : conflict ? `${conflict.target} / ${conflict.relatedTarget}` : "";
              return (
                <li className="translation-term translation-term--alert" key={key} data-testid="translation-alert">
                  <span className="translation-term__pair">
                    <strong>{pair}</strong>
                    <Badge tone={severityTone[severity] ?? "neutral"}>{t.severity[severity] ?? severity}</Badge>
                  </span>
                  <span className="translation-term__note">
                    {detail}
                    {suggestion?.reason ?? conflict?.message ? <> · {suggestion?.reason ?? conflict?.message}</> : null}
                  </span>
                  {canApply && suggestion ? (
                    <Button
                      size="sm"
                      icon={<Check />}
                      aria-label={t.applySuggestionFor(suggestion.source)}
                      loading={memory.resolving.has(key)}
                      onClick={() => memory.applySuggestion(suggestion)}
                    >
                      {t.applySuggestion}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Section>
  );
}
