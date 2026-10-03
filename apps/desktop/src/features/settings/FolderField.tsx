import { ExternalLink, FolderOpen } from "lucide-react";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { isTauriRuntime } from "../../core/windowControls";
import { getErrorMessage } from "../../services/backendClient";
import { openLocalPath, pickExportRoot } from "../../services/localFiles";
import { settingsStrings } from "../../strings/settings";
import { Button, cx, TextField, useToast } from "../../ui";
import "./settings.css";

/**
 * Folder path field with "Escolher…" (native picker) and, optionally, "Abrir pasta".
 * Both buttons need the desktop runtime; in the browser they stay visible but disabled.
 * Shared by Ajustes and the onboarding.
 */
export function FolderField({
  id,
  label,
  hideLabel,
  value,
  onChange,
  onCommit,
  onPick,
  hint,
  error,
  placeholder,
  showOpen = false,
  labelledBy
}: {
  id?: string;
  label: string;
  hideLabel?: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Called on blur and Enter, for fields that save on commit. */
  onCommit?: () => void;
  onPick: (path: string) => void;
  hint?: ReactNode;
  error?: ReactNode;
  placeholder?: string;
  showOpen?: boolean;
  labelledBy?: string;
}) {
  const [picking, setPicking] = useState(false);
  const { toast } = useToast();
  const desktop = isTauriRuntime();

  const pick = () => {
    setPicking(true);
    // Dialog opened by Rust: the folder becomes the output root there too (export_root.rs).
    void pickExportRoot({ defaultPath: value || undefined, title: settingsStrings.pickOutputFolderTitle })
      .then((path) => {
        if (path) onPick(path);
      })
      .catch((err: unknown) => toast({ message: getErrorMessage(err, settingsStrings.pickFolderFailed), tone: "danger" }))
      .finally(() => setPicking(false));
  };

  const open = () => {
    void openLocalPath(value).catch(() => toast({ message: settingsStrings.openFolderFailed, tone: "danger" }));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && onCommit) {
      event.preventDefault();
      onCommit();
    }
  };

  return (
    <div className={cx("settings-folder", !hideLabel && "settings-folder--labelled")}>
      <TextField
        id={id}
        label={label}
        hideLabel={hideLabel}
        aria-labelledby={labelledBy}
        value={value}
        placeholder={placeholder}
        hint={hint}
        error={error}
        spellCheck={false}
        className="settings-folder__input"
        fieldClassName="settings-folder__field"
        leading={<FolderOpen />}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={onKeyDown}
      />
      <div className="settings-folder__actions">
        <Button
          icon={<FolderOpen />}
          data-testid="pick-output-folder"
          onClick={pick}
          loading={picking}
          disabled={!desktop}
          title={desktop ? undefined : settingsStrings.pickUnavailable}
        >
          {settingsStrings.pickOutputFolder}
        </Button>
        {showOpen ? (
          <Button
            variant="ghost"
            icon={<ExternalLink />}
            onClick={open}
            disabled={!desktop || !value.trim()}
            title={desktop ? undefined : settingsStrings.pickUnavailable}
          >
            {settingsStrings.openFolder}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
