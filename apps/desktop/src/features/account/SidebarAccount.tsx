import { LogIn, LogOut, Settings, UserRound, Users } from "lucide-react";
import { getPlatform } from "../../shell/platform";
import { oghmaAccountStrings as s } from "../../strings/oghmaAccount";
import { socialStrings } from "../../strings/social";
import { Avatar, DropdownMenu, Spinner, cx, type MenuItem } from "../../ui";
import type { AccountSheetStep } from "./AccountSheet";
import type { OghmaAccountController } from "./useOghmaAccount";
import "./oghmaAccount.css";

type Props = {
  account: OghmaAccountController;
  collapsed: boolean;
  /** Messages, friend requests and new recommendations waiting (0 hides the badge). */
  friendsAttention: number;
  /** The server has the social side: the menu offers "Amigos". */
  friendsAvailable: boolean;
  /** Amigos or Ajustes is open (highlights the friends button or the profile row). */
  place: "friends" | "settings" | null;
  onOpenSheet: (step: AccountSheetStep) => void;
  onOpenFriends: () => void;
  onOpenSettings: () => void;
};

/** "⌘," on the Mac, "Ctrl+," elsewhere. */
export const settingsShortcut = () => (getPlatform() === "macos" ? "⌘," : "Ctrl+,");

const Count = ({ value }: { value: number }) => <span className="sidebar-account__count">{value > 99 ? "99+" : value}</span>;

/**
 * Bottom of the sidebar, like the App Store and Music: the reader's photo and nickname, which open
 * a menu (upwards) with Editar perfil, Ajustes and Sair. Right next to it, like Discord's user
 * panel, the Amigos button with the count of what is waiting. Collapsed: the photo alone, with
 * the count on it and Amigos in the menu. Signed out: "Entrar" and "Ajustes" as two plain rows.
 */
export function SidebarAccount({ account, collapsed, friendsAttention, friendsAvailable, place, onOpenSheet, onOpenFriends, onOpenSettings }: Props) {
  if (!account.signedIn) {
    // Signed out: "Entrar" in one click, and Ajustes stays in reach right below it.
    return (
      <ul role="list" className="o-sidebar__menu">
        <li>
          <button
            type="button"
            className="o-sidebar__item sidebar-account sidebar-account--out"
            onClick={() => onOpenSheet("email")}
            disabled={account.status === "loading"}
            title={collapsed ? s.signIn : undefined}
            data-testid="account-sign-in"
          >
            <span className="o-sidebar__icon" aria-hidden="true"><LogIn /></span>
            <span className="o-sidebar__label">{s.signIn}</span>
          </button>
        </li>
        <li>
          <button
            type="button"
            className={cx("o-sidebar__item", place === "settings" && "is-active")}
            onClick={onOpenSettings}
            title={collapsed ? s.settings : settingsShortcut()}
            aria-current={place === "settings" ? "page" : undefined}
            data-testid="nav-settings"
          >
            <span className="o-sidebar__icon" aria-hidden="true"><Settings /></span>
            <span className="o-sidebar__label">{s.settings}</span>
          </button>
        </li>
      </ul>
    );
  }

  const user = account.user;
  const name = user?.nickname ?? user?.email ?? s.name;
  // Expanded, Amigos has its own button on the row; the photo carries the count only when
  // the rail is collapsed (and the menu keeps "Amigos" for that case).
  const friendsButton = friendsAvailable && !collapsed;
  const photoCount = friendsAvailable && collapsed ? friendsAttention : 0;
  const items: MenuItem[] = [
    { label: user?.nickname ? `@${user.nickname}` : s.name, description: user?.email ?? undefined, info: true, onSelect: () => undefined },
    ...(friendsAvailable && collapsed
      ? [{ label: socialStrings.title, icon: <Users />, onSelect: onOpenFriends, trailing: friendsAttention ? <Count value={friendsAttention} /> : undefined, separatorBefore: true }]
      : []),
    { label: user?.needsProfile ? s.profileTitle : s.editProfile, icon: <UserRound />, onSelect: () => onOpenSheet("profile"), separatorBefore: !(friendsAvailable && collapsed) },
    { label: s.settings, icon: <Settings />, onSelect: onOpenSettings, trailing: <kbd className="sidebar-account__kbd">{settingsShortcut()}</kbd> },
    { label: s.signOut, icon: <LogOut />, onSelect: () => void account.logout(), separatorBefore: true }
  ];
  return (
    <div className="sidebar-profile">
      <DropdownMenu
        label={s.menuLabel(name)}
        align="start"
        className="sidebar-account-menu"
        items={items}
        trigger={(
          <button
            type="button"
            className={cx("o-sidebar__item", "sidebar-account", (place === "settings" || (collapsed && place === "friends")) && "is-active")}
            title={collapsed ? name : undefined}
            aria-label={photoCount ? `${s.menuLabel(name)} (${socialStrings.buttonHint(photoCount)})` : s.menuLabel(name)}
            data-testid="account-button"
          >
            <span className="sidebar-account__avatar">
              <Avatar avatarId={user?.avatarId} color={user?.avatarColor} nickname={name} size="sm" />
              {account.sync.state === "syncing" ? <Spinner size="sm" className="sidebar-account__sync" /> : null}
              {photoCount ? (
                <span key={photoCount} className="sidebar-account__badge" aria-hidden="true">{photoCount > 99 ? "99+" : photoCount}</span>
              ) : null}
            </span>
            <span className="o-sidebar__label sidebar-account__name">{name}</span>
          </button>
        )}
      />
      {friendsButton ? (
        <button
          type="button"
          className={cx("sidebar-friends", place === "friends" && "is-active", friendsAttention > 0 && "has-news")}
          onClick={onOpenFriends}
          aria-label={friendsAttention ? `${socialStrings.title} (${socialStrings.buttonHint(friendsAttention)})` : socialStrings.title}
          aria-current={place === "friends" ? "page" : undefined}
          title={socialStrings.title}
          data-testid="nav-social"
        >
          <Users aria-hidden="true" />
          {friendsAttention ? <span key={friendsAttention} className="sidebar-friends__count" aria-hidden="true">{friendsAttention > 99 ? "99+" : friendsAttention}</span> : null}
        </button>
      ) : null}
    </div>
  );
}
