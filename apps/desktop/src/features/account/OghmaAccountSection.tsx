import { Laptop, LogOut, Monitor, Pencil, RefreshCw, Trash2, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type { AccountSessionInfo } from "../../services/accountClient";
import { oghmaAccountStrings as s, accountErrorMessage } from "../../strings/oghmaAccount";
import { Avatar, Button, ConfirmationModal, ListGroup, ListRow, Spinner, TextField, useToast } from "../../ui";
import { formatRelativeSync } from "../sources/lastSync";
import type { AccountSheetStep } from "./AccountSheet";
import type { OghmaAccountController } from "./useOghmaAccount";
import "./oghmaAccount.css";

type Props = {
  account: OghmaAccountController;
  onOpenSheet: (step: AccountSheetStep) => void;
};

function ago(iso: string | number | null | undefined) {
  if (!iso) return "";
  const date = typeof iso === "number" ? new Date(iso).toISOString() : iso;
  return formatRelativeSync(date).label.toLowerCase();
}

/** Ajustes > Conta: the Oghma account (profile, sync, devices, sign out, delete). */
export function OghmaAccountSection({ account, onOpenSheet }: Props) {
  const { toast } = useToast();
  const [sessions, setSessions] = useState<AccountSessionInfo[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState<"logout" | "delete" | null>(null);
  const [serverDraft, setServerDraft] = useState(account.serverUrl);
  const user = account.user;

  useEffect(() => setServerDraft(account.serverUrl), [account.serverUrl]);
  useEffect(() => {
    if (!account.signedIn) {
      setSessions(null);
      return;
    }
    let cancelled = false;
    void account.listSessions().then((list) => {
      if (!cancelled) setSessions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [account.signedIn, account.listSessions, account]);

  if (!account.available) {
    return (
      <ListGroup title={s.oghmaHeading}>
        <ListRow icon={<UserRound />} label={s.name} description={s.unavailable} />
      </ListGroup>
    );
  }
  if (account.status === "loading") {
    return (
      <ListGroup title={s.oghmaHeading}>
        <ListRow icon={<Spinner size="sm" />} label={s.name} description={s.syncing} />
      </ListGroup>
    );
  }
  if (!account.signedIn) {
    return (
      <div className="oghma-account" data-testid="oghma-account-signed-out">
        <div className="oghma-account__hero">
          <div className="oghma-account__stack" aria-hidden="true">
            <Avatar avatarId="sung-jinwoo" size="lg" />
            <Avatar avatarId="megumin" size="lg" />
            <Avatar avatarId="holo" size="lg" />
          </div>
          <h3 className="oghma-account__title">{s.signedOutTitle}</h3>
          <p className="oghma-account__text">{s.signedOutHint}</p>
          <Button variant="primary" onClick={() => onOpenSheet("email")} data-testid="oghma-account-sign-in">{s.signInOrCreate}</Button>
        </div>
        <ListGroup footer={s.serverHint}>
          <ListRow label={s.server} stacked>
            <TextField
              label={s.server}
              hideLabel
              value={serverDraft}
              onChange={(event) => setServerDraft(event.target.value)}
              onBlur={() => account.setServerUrl(serverDraft)}
              onKeyDown={(event) => {
                if (event.key === "Enter") account.setServerUrl(serverDraft);
              }}
              fieldClassName="o-field--sm"
              spellCheck={false}
            />
          </ListRow>
        </ListGroup>
      </div>
    );
  }

  const syncDescription = account.sync.state === "syncing"
    ? s.syncing
    : account.sync.state === "error"
      ? s.syncError
      : account.sync.lastSyncAt
        ? s.syncedAgo(ago(account.sync.lastSyncAt))
        : s.neverSynced;

  return (
    <div className="oghma-account" data-testid="oghma-account">
      <div className="oghma-account__profile">
        <Avatar avatarId={user?.avatarId} color={user?.avatarColor} nickname={user?.nickname ?? user?.email} size="xl" />
        <div className="oghma-account__who">
          <span className="oghma-account__nickname" data-testid="oghma-account-nickname">{user?.nickname ?? s.profileTitle}</span>
          <span className="oghma-account__email">{user?.email}</span>
        </div>
        <Button size="sm" variant="outline" icon={<Pencil />} onClick={() => onOpenSheet("profile")} data-testid="oghma-account-edit">
          {user?.needsProfile ? s.profileTitle : s.editProfile}
        </Button>
      </div>

      <ListGroup title={s.library} footer={s.syncFooter}>
        <ListRow label={s.syncLabel} description={syncDescription}>
          <Button
            size="sm"
            variant="ghost"
            icon={<RefreshCw />}
            loading={account.sync.state === "syncing"}
            onClick={() => void account.syncNow()}
            data-testid="oghma-account-sync"
          >
            {s.syncNow}
          </Button>
        </ListRow>
      </ListGroup>

      <ListGroup title={s.devices}>
        {sessions === null ? (
          <ListRow icon={<Spinner size="sm" />} label={s.devices} />
        ) : sessions.map((session) => (
          <ListRow
            key={session.id}
            icon={session.platform === "macos" ? <Laptop /> : <Monitor />}
            label={session.current ? `${session.deviceName || s.thisDevice} · ${s.thisDevice}` : session.deviceName || session.platform}
            description={s.lastSeen(ago(session.lastSeenAt))}
          >
            {session.current ? null : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void account.endSession(session.id).then((ok) => {
                  if (!ok) return;
                  setSessions((list) => list?.filter((item) => item.id !== session.id) ?? null);
                  toast({ message: s.deviceDisconnected, tone: "success" });
                })}
              >
                {s.disconnect}
              </Button>
            )}
          </ListRow>
        ))}
      </ListGroup>

      <ListGroup>
        <ListRow label={s.signOut} description={s.signOutHint}>
          <Button
            size="sm"
            variant="ghost"
            icon={<LogOut />}
            loading={busy === "logout"}
            onClick={() => {
              setBusy("logout");
              void account.logout().finally(() => {
                setBusy(null);
                toast({ message: s.signedOut, tone: "info" });
              });
            }}
            data-testid="oghma-account-sign-out"
          >
            {s.signOut}
          </Button>
        </ListRow>
        <ListRow label={s.deleteAccount} description={s.deleteAccountHint}>
          <Button size="sm" variant="ghost" className="oghma-account__danger" icon={<Trash2 />} onClick={() => setConfirmDelete(true)}>
            {s.deleteAccount}
          </Button>
        </ListRow>
      </ListGroup>

      <ConfirmationModal
        open={confirmDelete}
        tone="danger"
        onClose={() => setConfirmDelete(false)}
        title={s.deleteConfirmTitle}
        description={s.deleteConfirmDescription}
        confirmLabel={s.deleteConfirm}
        onConfirm={() => {
          setConfirmDelete(false);
          setBusy("delete");
          void account.deleteAccount().then((result) => {
            setBusy(null);
            toast(result.ok ? { message: s.accountDeleted, tone: "success" } : { message: accountErrorMessage(result.error), tone: "danger" });
          });
        }}
      />
    </div>
  );
}
