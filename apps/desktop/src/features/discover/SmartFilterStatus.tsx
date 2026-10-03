import { Sparkles, X } from "lucide-react";
import type { SmartResult, SmartStage } from "../../services/smartFilter";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, IconButton, Spinner } from "../../ui";

export type SmartStageInfo = { stage: SmartStage; candidates?: number };

export type SmartFilterStatusProps = {
  result: SmartResult | null;
  busy: boolean;
  stage?: SmartStageInfo | null;
  /** Curated result: also showing the novels that only share tags. */
  broad?: boolean;
  /** Novels allowed by the filters (what "por tags" would show). */
  broadCount?: number;
  onToggleBroad?: () => void;
  onClear: () => void;
};

/**
 * One line above the grid while "Sugerir parecidos" runs and after it: what the model
 * understood, how many novels it kept after reading the synopses, the tag-only list on demand
 * and a way out. Nothing at all when no suggestion is active (the Buscar page stays clean).
 */
export function SmartFilterStatus({
  result,
  busy,
  stage = null,
  broad = false,
  broadCount = 0,
  onToggleBroad,
  onClear
}: SmartFilterStatusProps) {
  if (!busy && !result) return null;
  return (
    <section className="smart-filter" aria-label={discoverStrings.smartTitle} data-testid="smart-filter">
      {busy ? (
        <p className="smart-filter__line" role="status" data-testid="smart-filter-stage">
          <Spinner size="sm" />
          <span className="smart-filter__summary">
            {stage?.stage === "reading" ? discoverStrings.smartReading(stage.candidates ?? 0) : discoverStrings.smartUnderstanding}
          </span>
        </p>
      ) : result ? (
        <div className="smart-filter__line" data-testid="smart-filter-result">
          <Badge tone={result.source === "ai" ? "accent" : "neutral"}>
            <Sparkles aria-hidden="true" />
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
      ) : null}
    </section>
  );
}
