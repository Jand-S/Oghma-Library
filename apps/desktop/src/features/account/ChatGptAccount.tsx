import { ExternalLink, KeyRound, LogOut, RefreshCcw, Settings2 } from "lucide-react";
import type { AccountController } from "../../app/account";
import { accountStrings as a } from "../../strings/account";
import { translationStrings as t } from "../../strings/translation";
import { Button, DropdownMenu, ListGroup, ListRow, Spinner, cx, type MenuItem } from "../../ui";
import { formatCredits, formatWords } from "../translation/translationFormat";
import "./account.css";

function initialOf(email?: string) {
  return (email?.trim()[0] ?? "C").toUpperCase();
}

export function AccountAvatar({ email, off = false, size = "md" }: { email?: string; off?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={cx("account-avatar", `account-avatar--${size}`, off && "is-off")} aria-hidden="true">
      {off ? <KeyRound /> : initialOf(email)}
    </span>
  );
}

/** Connect / waiting / cancel, for any screen that needs the ChatGPT login. */
export function ChatGptConnectButton({ account, size = "md", label = t.connect }: { account: AccountController; size?: "sm" | "md"; label?: string }) {
  if (account.connecting) {
    return (
      <span className="account-connecting" role="status" data-testid="translation-connecting">
        <Spinner size="sm" />
        <span>{t.connectWaiting}</span>
        <Button size="sm" variant="ghost" onClick={account.cancelConnect}>{t.connectCancel}</Button>
      </span>
    );
  }
  return <Button size={size} variant="primary" onClick={() => void account.connect()}>{label}</Button>;
}

/** Ajustes > Conta: the ChatGPT account as an Apple-style grouped list. */
export function ChatGptAccountCard({ account, onRetry }: { account: AccountController; onRetry?: () => void }) {
  const state = account.account;
  const local = account.usage?.local;

  if (state.status === "unavailable") {
    return (
      <ListGroup footer={a.usedFor}>
        <ListRow icon={<KeyRound />} label={t.accountHeading} description={a.unavailable} />
      </ListGroup>
    );
  }
  if (state.status === "loading") {
    return (
      <ListGroup footer={a.usedFor}>
        <ListRow icon={<Spinner size="sm" />} label={t.accountHeading} description={a.loading} />
      </ListGroup>
    );
  }
  if (state.status === "error") {
    return (
      <ListGroup footer={a.usedFor}>
        <ListRow icon={<KeyRound />} label={t.accountError} description={state.message}>
          {onRetry ? <Button size="sm" variant="outline" icon={<RefreshCcw />} onClick={onRetry}>{t.checkAgain}</Button> : null}
        </ListRow>
      </ListGroup>
    );
  }
  if (state.status === "logged_out") {
    return (
      <div data-testid="account-card">
        <ListGroup footer={a.usedFor}>
          <ListRow icon={<AccountAvatar off />} label={t.accountDisconnected} description={t.accountDisconnectedHint}>
            <ChatGptConnectButton account={account} size="sm" label={t.connectShort} />
          </ListRow>
        </ListGroup>
      </div>
    );
  }
  return (
    <div data-testid="account-card">
      <ListGroup footer={a.usedFor}>
        <ListRow
          icon={<AccountAvatar email={state.email} />}
          label={<span data-testid="account-email">{state.email ?? t.accountConnected}</span>}
          description={state.planType ? a.plan(state.planType) : t.usingPlan}
        >
          <Button size="sm" variant="ghost" icon={<LogOut />} loading={account.isBusy("logout")} onClick={() => void account.logout()}>{t.logout}</Button>
        </ListRow>
        {local ? (
          <ListRow label={a.usage5h} description={a.usageWeek(formatWords(local.words7d), formatCredits(local.credits7d))}>
            <span data-testid="account-local-usage">{a.usageValue(formatWords(local.words5h), formatCredits(local.credits5h))}</span>
          </ListRow>
        ) : null}
        <ListRow label={t.manageUsage} description={t.manageUsageHint}>
          <Button size="sm" variant="ghost" iconRight={<ExternalLink />} onClick={account.openUsagePage}>{a.open}</Button>
        </ListRow>
      </ListGroup>
    </div>
  );
}

/** Compact account control for a page header: avatar button with the account menu. */
export function AccountMenuButton({ account, onOpenSettings }: { account: AccountController; onOpenSettings: () => void }) {
  const state = account.account;
  if (state.status !== "logged_in") return null;
  const local = account.usage?.local;
  const items: MenuItem[] = [
    { label: state.email ?? t.accountConnected, onSelect: () => undefined, disabled: true },
    ...(local ? [{ label: a.usageValueLong(formatWords(local.words5h), formatCredits(local.credits5h)), onSelect: () => undefined, disabled: true }] : []),
    { label: t.manageUsage, icon: <ExternalLink />, onSelect: account.openUsagePage, separatorBefore: true },
    { label: a.openSettings, icon: <Settings2 />, onSelect: onOpenSettings },
    { label: t.logout, icon: <LogOut />, onSelect: () => void account.logout(), separatorBefore: true }
  ];
  return (
    <DropdownMenu
      label={t.accountHeading}
      align="end"
      items={items}
      trigger={(
        <button type="button" className="account-menu-trigger" aria-label={a.menuLabel(state.email)} title={state.email} data-testid="account-menu">
          <AccountAvatar email={state.email} size="sm" />
        </button>
      )}
    />
  );
}
