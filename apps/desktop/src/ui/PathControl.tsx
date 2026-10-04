import { ChevronRight, Copy, Folder, FolderOpen } from "lucide-react";
import { DropdownMenu, useContextMenu } from "./DropdownMenu";
import { cx } from "./cx";
import "./PathControl.css";

export type PathControlProps = {
  path: string;
  /** How many trailing folders to show (default 2). */
  segments?: number;
  /** Click: reveal the folder in Finder/Explorer. Without it the control is static. */
  onReveal?: () => void;
  revealLabel?: string;
  copyLabel?: string;
  className?: string;
  "data-testid"?: string;
};

export function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

/** Finder-style path bar: folder icon and the last folders, full path in the tooltip and context menu. */
export function PathControl({
  path,
  segments = 2,
  onReveal,
  revealLabel = "Mostrar no Finder",
  copyLabel = "Copiar caminho",
  className,
  ...rest
}: PathControlProps) {
  const menu = useContextMenu();
  const parts = pathSegments(path);
  const shown = parts.slice(-segments);
  const truncated = parts.length > shown.length;
  const copy = () => void navigator.clipboard?.writeText(path).catch(() => undefined);

  const content = (
    <>
      {truncated ? <span className="o-path__more" aria-hidden="true">…<ChevronRight /></span> : null}
      {shown.map((part, index) => (
        <span key={`${part}-${index}`} className="o-path__segment">
          {index === 0 ? <Folder aria-hidden="true" /> : <ChevronRight aria-hidden="true" className="o-path__sep" />}
          {index > 0 ? <Folder aria-hidden="true" /> : null}
          <span className="o-path__name">{part}</span>
        </span>
      ))}
    </>
  );

  return (
    <>
      {onReveal ? (
        <button
          type="button"
          className={cx("o-path", "o-path--interactive", className)}
          title={path}
          aria-label={`${revealLabel}: ${path}`}
          onClick={onReveal}
          onContextMenu={menu.onContextMenu}
          data-testid={rest["data-testid"]}
        >
          {content}
        </button>
      ) : (
        <span className={cx("o-path", className)} title={path} onContextMenu={menu.onContextMenu} data-testid={rest["data-testid"]}>
          {content}
        </span>
      )}
      <DropdownMenu
        open={menu.open}
        position={menu.position}
        onClose={menu.onClose}
        label={path}
        items={[
          ...(onReveal ? [{ label: revealLabel, icon: <FolderOpen />, onSelect: onReveal }] : []),
          { label: copyLabel, icon: <Copy />, onSelect: copy }
        ]}
      />
    </>
  );
}
