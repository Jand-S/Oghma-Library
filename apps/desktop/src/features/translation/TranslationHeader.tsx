import type { AppControllers, ViewHeader } from "../../app/viewRegistry";
import { translationStrings as t } from "../../strings/translation";
import { Badge } from "../../ui";

/** Tradução's PageHeader content: how many books are being translated. */
export function translationHeader(app: AppControllers): ViewHeader {
  const count = app.translation.projects.length;
  if (count === 0) return {};
  return { badge: <Badge data-testid="translation-count">{t.projectCount(count)}</Badge> };
}
