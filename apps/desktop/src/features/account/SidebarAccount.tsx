import { LogOut, Settings2, UserRound } from "lucide-react";
import { oghmaAccountStrings as s } from "../../strings/oghmaAccount";
import { Avatar, DropdownMenu, Spinner, cx } from "../../ui";
import type { AccountSheetStep } from "./AccountSheet";
import type { OghmaAccountController } from "./useOghmaAccount";
import "./oghmaAccount.css";

type Props = {
  account: OghmaAccountController;
  collapsed: boolean;
  onOpenSheet: (step: AccountSheetStep) => void;
  onOpenSettings: () => void;
};

/**
 * Bottom of the sidebar, like Music and the App Store: avatar and nickname with the account
 * menu, or a quiet "Entrar" when signed out. Hidden outside the desktop app.
 */
export function SidebarAccount({ account, collapsed, onOpenSheet, onOpenSettings }: Props) {
  if (!account.available || account.status === "loading") return null;
  if (!account.signedIn) {
    return (
      <button
        type="button"
        className="o-sidebar__item sidebar-account sidebar-account--out"
        onClick={() => onOpenSheet("email")}
        title={collapsed ? s.signIn : undefined}
        data-testid="sidebar-account-sign-in"
      >
        <span className="o-sidebar__icon" aria-hidden="true"><UserRound /></span>
        <span className="o-sidebar__label">{s.signIn}</span>
      </button>
    );
  }
  const user = account.user;
  const name = user?.nickname ?? user?.email ?? s.name;
  return (
    <DropdownMenu
      label={s.menuLabel(name)}
      align="start"
      items={[
        { label: user?.email ?? s.name, onSelect: () => undefined, disabled: true },
        { label: user?.needsProfile ? s.profileTitle : s.editProfile, icon: <UserRound />, onSelect: () => onOpenSheet("profile"), separatorBefore: true },
        { label: s.openAccount, icon: <Settings2 />, onSelect: onOpenSettings },
        { label: s.signOut, icon: <LogOut />, onSelect: () => void account.logout(), separatorBefore: true }
      ]}
      trigger={(
        <button
          type="button"
          className={cx("o-sidebar__item", "sidebar-account")}
          title={collapsed ? name : undefined}
          aria-label={s.menuLabel(name)}
          data-testid="sidebar-account"
        >
          <span className="sidebar-account__avatar">
            <Avatar avatarId={user?.avatarId} color={user?.avatarColor} nickname={name} size="xs" />
            {account.sync.state === "syncing" ? <Spinner size="sm" className="sidebar-account__sync" /> : null}
          </span>
          <span className="o-sidebar__label sidebar-account__name">{name}</span>
        </button>
      )}
    />
  );
}
