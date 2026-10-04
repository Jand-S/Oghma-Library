import type { LimitState } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Banner } from "../../ui";
import { formatCountdown, useNow } from "./translationFormat";

/** "Limite do ChatGPT atingido (janela de 5h). Tentando de novo em 12min 05s." — ticking. */
export function limitMessage(limit: Pick<LimitState, "window"> | null, retryAt: number | null, now: number) {
  const window = limit ? t.limitWindow[limit.window] ?? "" : "";
  if (retryAt == null) return t.bannerWaitingRetry;
  const remaining = retryAt - now;
  return remaining > 0 ? t.limitBanner(window, formatCountdown(remaining)) : t.limitBannerSoon(window);
}

/** Global warning while ChatGPT refuses requests for usage limits. */
export function LimitBanner({ limit }: { limit: LimitState }) {
  const now = useNow(1000);
  return (
    <div title={t.limitTooltip} data-testid="translation-limit">
      <Banner tone="warning">
        <span data-testid="translation-limit-text">{limitMessage(limit, limit.nextRetryAt, now)}</span>
      </Banner>
    </div>
  );
}
