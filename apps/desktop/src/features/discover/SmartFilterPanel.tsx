import { Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SmartResult, SmartStage } from "../../services/smartFilter";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, IconButton, TextField } from "../../ui";

export type SmartStageInfo = { stage: SmartStage; candidates?: number };

export type SmartFilterPanelProps = {
  result: SmartResult | null;
  busy: boolean;
  stage?: SmartStageInfo | null;
  /** Curated result: also showing the novels that only share tags. */
  broad?: boolean;
  /** Novels allowed by the filters (what "por tags" would show). */
  broadCount?: number;
  onToggleBroad?: () => void;
  /** The ChatGPT login exists (translation account): answers come from the model. */
  aiAvailable: boolean;
  onAsk: (request: string) => void;
  onClear: () => void;
};

/**
 * "Filtro inteligente": the request in plain words becomes the normal filters (shown and
 * editable in the bar below) plus an order by similarity with a reason on each card. With
 * ChatGPT, story requests are curated: the grid shows only the novels the model kept after
 * reading the synopses.
 */
export function SmartFilterPanel({
  result,
  busy,
  stage = null,
  broad = false,
  broadCount = 0,
  onToggleBroad,
  aiAvailable,
  onAsk,
  onClear
}: SmartFilterPanelProps) {
  const [request, setRequest] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = request.trim();
    if (text && !busy) onAsk(text);
  };
  return (
    <section className="smart-filter" aria-label={discoverStrings.smartTitle} data-testid="smart-filter">
      <form className="smart-filter__form" onSubmit={submit}>
        <TextField
          label={discoverStrings.smartTitle}
          hideLabel
          leading={<Sparkles />}
          placeholder={discoverStrings.smartPlaceholder}
          value={request}
          onChange={(event) => setRequest(event.target.value)}
          fieldClassName="smart-filter__field"
          data-testid="smart-filter-input"
        />
        <Button type="submit" variant="primary" size="sm" loading={busy} disabled={!request.trim()}>
          {discoverStrings.smartAsk}
        </Button>
      </form>
      {busy && stage ? (
        <p className="smart-filter__hint" role="status" data-testid="smart-filter-stage">
          {stage.stage === "reading" ? discoverStrings.smartReading(stage.candidates ?? 0) : discoverStrings.smartUnderstanding}
        </p>
      ) : result ? (
        <div className="smart-filter__result" data-testid="smart-filter-result">
          <Badge tone={result.source === "ai" ? "accent" : "neutral"}>
            {result.source === "ai" ? discoverStrings.smartByAi : discoverStrings.smartLocal}
          </Badge>
          <span className="smart-filter__summary" title={result.intent.summary}>{result.intent.summary}</span>
          {result.picks ? (
            <span className="smart-filter__picks" data-testid="smart-filter-picks">
              {discoverStrings.smartPicked(result.picks.length, result.candidatesRead ?? 0)}
            </span>
          ) : result.curationFailed ? (
            <span className="smart-filter__picks">{discoverStrings.smartCurationFailed}</span>
          ) : null}
          {result.picks && result.picks.length > 0 && onToggleBroad ? (
            <Button size="sm" variant="ghost" onClick={onToggleBroad} data-testid="smart-filter-broad">
              {broad ? discoverStrings.smartShowPicks : discoverStrings.smartShowBroadCount(broadCount)}
            </Button>
          ) : null}
          <IconButton size="sm" variant="ghost" icon={<X />} label={discoverStrings.smartClear} onClick={onClear} />
        </div>
      ) : (
        <p className="smart-filter__hint">{aiAvailable ? discoverStrings.smartHintAi : discoverStrings.smartHintLocal}</p>
      )}
    </section>
  );
}
