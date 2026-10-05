import { BookOpenText, Download, House, Languages, Search, Settings, Tablet } from "lucide-react";
import type { AppView } from "../app/NavigationContext";
import { navGroupStrings, navStrings } from "../strings/common";

export type NavItem = {
  id: AppView;
  label: string;
  icon: typeof Search;
};

const item = (id: NavItem["id"], icon: NavItem["icon"]): NavItem => ({ id, label: navStrings[id as keyof typeof navStrings], icon });

export type NavGroup = {
  id: string;
  /** Small caption above the group (none for the first one), like the Music.app sidebar. */
  label?: string;
  items: NavItem[];
};

/** Sidebar groups, top to bottom. "settings" is pinned to the bottom of the sidebar. */
export const navGroups: NavGroup[] = [
  { id: "discover", items: [item("home", House), item("discover", Search)] },
  { id: "library", label: navGroupStrings.library, items: [item("library", BookOpenText), item("downloads", Download), item("kindle", Tablet)] },
  // "Fontes" moved into Ajustes (category "Fontes").
  { id: "tools", label: navGroupStrings.tools, items: [item("translation", Languages)] }
];

/** Every sidebar entry in display order (without settings). */
export const navItems: NavItem[] = navGroups.flatMap((group) => group.items);

export const settingsNavItem: NavItem = { id: "settings", label: navStrings.settings, icon: Settings };
