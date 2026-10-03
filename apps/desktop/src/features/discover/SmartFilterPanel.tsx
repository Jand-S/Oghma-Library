import { Sparkles, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { SmartResult } from "../../services/smartFilter";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, IconButton, TextField } from "../../ui";

export type SmartFilterPanelProps = {
  result: SmartResult | null;
  busy: boolean;
  /** The ChatGPT login exists (translation account): answers come from the model. */
  aiAvailable: boolean;
  onAsk: (request: string) => void;
  onClear: () => void;
};

/**
 * "Filtro inteligente": the request in plain words becomes the normal filters (shown and
 * editable in the bar below) plus an order by similarity with a reason on each card.
 */
export function SmartFilterPanel({ result, busy, aiAvailable, onAsk, onClear }: SmartFilterPanelProps) {
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
      {result ? (
        <div className="smart-filter__result" data-testid="smart-filter-result">
          <Badge tone={result.source === "ai" ? "accent" : "neutral"}>
            {result.source === "ai" ? discoverStrings.smartByAi : discoverStrings.smartLocal}
          </Badge>
          <span className="smart-filter__summary">{result.intent.summary}</span>
          <IconButton size="sm" variant="ghost" icon={<X />} label={discoverStrings.smartClear} onClick={onClear} />
        </div>
      ) : (
        <p className="smart-filter__hint">{aiAvailable ? discoverStrings.smartHintAi : discoverStrings.smartHintLocal}</p>
      )}
    </section>
  );
}
