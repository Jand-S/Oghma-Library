export const settingsCategories = ["general", "downloads", "server", "kindle", "audio", "about"] as const;
export type SettingsCategory = (typeof settingsCategories)[number];

export function isSettingsCategory(value: unknown): value is SettingsCategory {
  return typeof value === "string" && (settingsCategories as readonly string[]).includes(value);
}
