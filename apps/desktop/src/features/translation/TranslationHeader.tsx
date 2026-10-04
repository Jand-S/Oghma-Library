import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { translationStrings as t } from "../../strings/translation";
import { Badge } from "../../ui";
import { AccountMenuButton } from "../account/ChatGptAccount";

/** Tradução's PageHeader content: how many books are being translated, and the ChatGPT account menu. */
export function translationHeader(app: AppControllers): ViewHeader {
  const count = app.translation.projects.length;
  return {
    badge: count > 0 ? <Badge data-testid="translation-count">{t.projectCount(count)}</Badge> : undefined,
    actions: <AccountMenuButton account={app.account} onOpenSettings={() => app.navigate("settings", { section: "account" })} />
  };
}
