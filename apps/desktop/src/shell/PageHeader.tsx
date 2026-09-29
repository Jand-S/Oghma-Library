import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { shellStrings } from "../strings/common";
import { IconButton } from "../ui";
import "./PageHeader.css";

export type PageHeaderProps = {
  title: ReactNode;
  /** Shows a back button when set (usually `navigation.back` while `canGoBack`). */
  onBack?: () => void;
  /** Right-aligned actions. */
  actions?: ReactNode;
  /** Search input or other control placed after the title. */
  search?: ReactNode;
};

export function PageHeader({ title, onBack, actions, search }: PageHeaderProps) {
  return (
    <header className="o-page-header" data-tauri-drag-region>
      {onBack ? <IconButton label={shellStrings.back} icon={<ArrowLeft />} size="sm" onClick={onBack} /> : null}
      <h1 className="o-page-header__title" data-tauri-drag-region>{title}</h1>
      {search ? <div className="o-page-header__search">{search}</div> : null}
      <div className="o-page-header__spacer" data-tauri-drag-region />
      {actions ? <div className="o-page-header__actions">{actions}</div> : null}
    </header>
  );
}
