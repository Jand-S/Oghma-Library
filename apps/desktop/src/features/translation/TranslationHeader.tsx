import type { ViewHeader } from "../../app/viewRegistry";
import { translationStrings as t } from "../../strings/translation";
import { Badge } from "../../ui";

/** Tradução's PageHeader content: the "Beta" badge (the banner below explains the preview). */
export function translationHeader(): ViewHeader {
  return { badge: <Badge tone="warning" data-testid="translation-beta">{t.beta}</Badge> };
}
