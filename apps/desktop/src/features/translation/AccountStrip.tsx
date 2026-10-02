import { AlertTriangle, ExternalLink, KeyRound, LogOut } from "lucide-react";
import type { LimitState, UsageSnapshot } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Button, Skeleton, Spinner, cx } from "../../ui";
import { formatCountdown, formatCredits, formatWords, useNow } from "./translationFormat";
import type { TranslationAccountState } from "./useTranslationController";

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
    <div className="translation-limit" role="status" title={t.limitTooltip} data-testid="translation-limit">
      <AlertTriangle aria-hidden="true" />
      <span data-testid="translation-limit-text">{limitMessage(limit, limit.nextRetryAt, now)}</span>
    </div>
  );
}

function initialOf(email?: string) {
  return (email?.trim()[0] ?? "C").toUpperCase();
}

type AccountStripProps = {
  account: TranslationAccountState;
  connecting: boolean;
  loggingOut: boolean;
  usage: UsageSnapshot | null;
  onConnect: () => void;
  onCancelConnect: () => void;
  onLogout: () => void;
  onManageUsage: () => void;
};

/**
 * Account card: "Usando seu plano ChatGPT" + email, "Gerenciar uso" and "Sair", with the app's
 * own counters in a small line. There is no API for the plan's usage %, so none is shown.
 */
export function AccountStrip({ account, connecting, loggingOut, usage, onConnect, onCancelConnect, onLogout, onManageUsage }: AccountStripProps) {
  if (account.status === "loading") {
    return (
      <section className="translation-strip" aria-label={t.accountHeading} aria-busy="true">
        <span className="sr-only">{t.accountLoading}</span>
        <Skeleton width={40} height={40} radius="50%" />
        <div className="translation-account__text">
          <Skeleton width={160} height={12} />
          <Skeleton width={200} height={14} />
        </div>
      </section>
    );
  }

  const loggedIn = account.status === "logged_in";
  const local = usage?.local;

  return (
    <section className="translation-strip" aria-label={t.accountHeading} data-testid="translation-account">
      <span className={cx("translation-account__avatar", !loggedIn && "is-off")} aria-hidden="true">
        {loggedIn ? initialOf(account.email) : <KeyRound />}
      </span>
      <div className="translation-account__text">
        {loggedIn ? (
          <>
            <span className="translation-account__label">{t.usingPlan}</span>
            <span className="translation-account__name truncate" data-testid="translation-account-email" title={account.email}>
              {account.email ?? t.accountConnected}
            </span>
          </>
        ) : connecting ? (
          <>
            <span className="translation-account__label">{t.accountHeading}</span>
            <span className="translation-account__name translation-account__name--muted" role="status" data-testid="translation-connecting">
              <Spinner size="sm" />
              <span>{t.connectWaiting}</span>
            </span>
          </>
        ) : (
          <>
            <span className="translation-account__label">{t.accountDisconnected}</span>
            <span className="translation-account__name translation-account__name--muted">{t.accountDisconnectedHint}</span>
          </>
        )}
      </div>

      {loggedIn && local ? (
        <span className="translation-strip__local" data-testid="translation-local-usage" title={t.localUsageWeek(formatWords(local.words7d), formatCredits(local.credits7d))}>
          {t.localUsage(formatWords(local.words5h), formatCredits(local.credits5h))}
        </span>
      ) : (
        <span className="translation-strip__spacer" />
      )}

      <div className="translation-strip__actions">
        {loggedIn ? (
          <>
            <Button size="sm" variant="ghost" iconRight={<ExternalLink />} title={t.manageUsageHint} onClick={onManageUsage}>{t.manageUsage}</Button>
            <Button size="sm" variant="ghost" icon={<LogOut />} loading={loggingOut} onClick={onLogout}>{t.logout}</Button>
          </>
        ) : connecting ? (
          <Button size="sm" variant="ghost" onClick={onCancelConnect}>{t.connectCancel}</Button>
        ) : (
          <Button size="sm" variant="primary" onClick={onConnect}>{t.connect}</Button>
        )}
      </div>
    </section>
  );
}
