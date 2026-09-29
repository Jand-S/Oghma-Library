import { BookOpenText, Download, Globe2, Languages, Search, Settings, Tablet } from "lucide-react";
import type { AppView } from "../app/NavigationContext";
import { navStrings } from "../strings/common";

export type NavItem = {
  id: AppView;
  label: string;
  icon: typeof Search;
};

/** Sidebar entries, top to bottom. "settings" is pinned to the bottom of the sidebar. */
export const navItems: NavItem[] = [
  { id: "discover", label: navStrings.discover, icon: Search },
  { id: "downloads", label: navStrings.downloads, icon: Download },
  { id: "library", label: navStrings.library, icon: BookOpenText },
  { id: "kindle", label: navStrings.kindle, icon: Tablet },
  { id: "translation", label: navStrings.translation, icon: Languages },
  { id: "sources", label: navStrings.sources, icon: Globe2 }
];

export const settingsNavItem: NavItem = { id: "settings", label: navStrings.settings, icon: Settings };
