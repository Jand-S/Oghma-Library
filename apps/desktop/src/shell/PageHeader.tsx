import { ArrowLeft } from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { shellStrings } from "../strings/common";
import { IconButton } from "../ui";
import "./PageHeader.css";

export type PageHeaderProps = {
  title: ReactNode;
  /** Shows a back button when set (usually `navigation.back` while `canGoBack`). */
  onBack?: () => void;
  /** Count or status shown right after the title (a `Badge`, usually). */
  badge?: ReactNode;
  /** Search input or other primary control placed after the title. */
  search?: ReactNode;
  /** Right-aligned actions. */
  actions?: ReactNode;
  /** Called for clicks on the header background (not on a control), e.g. to dismiss a preview. */
  onBackgroundClick?: () => void;
};

const INTERACTIVE = "button, a, input, select, textarea, label, [role='radiogroup'], [role='group']";

export function PageHeader({ title, onBack, badge, search, actions, onBackgroundClick }: PageHeaderProps) {
  const onClick = onBackgroundClick
    ? (event: MouseEvent<HTMLElement>) => {
      const target = event.target;
      if (target instanceof Element && target.closest(INTERACTIVE)) return;
      onBackgroundClick();
    }
    : undefined;
  return (
    <header className="o-page-header" data-tauri-drag-region data-testid="page-header" onClick={onClick}>
      {onBack ? <IconButton label={shellStrings.back} icon={<ArrowLeft />} size="sm" onClick={onBack} /> : null}
      <h1 className="o-page-header__title" data-tauri-drag-region>{title}</h1>
      {badge ? <div className="o-page-header__badge">{badge}</div> : null}
      {search ? <div className="o-page-header__search">{search}</div> : null}
      <div className="o-page-header__spacer" data-tauri-drag-region />
      {actions ? <div className="o-page-header__actions">{actions}</div> : null}
    </header>
  );
}
