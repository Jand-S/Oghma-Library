import { ArrowDownToLine, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { updateStrings as s } from "../../strings/update";
import { Banner, Button, Modal, ProgressBar } from "../../ui";
import type { AppUpdateController } from "./useAppUpdate";
import "./update.css";

/**
 * Top-right of every page when a newer version exists: a small accent pill. It opens a sheet with
 * the release notes and "Atualizar e reiniciar"; the download shows its progress there.
 */
export function UpdateButton({ update }: { update: AppUpdateController }) {
  const [open, setOpen] = useState(false);
  const { state } = update;
  if (state.status === "idle") return null;

  const version = "version" in state ? state.version : undefined;
  const notes = ("notes" in state ? state.notes : "") ?? "";
  const busy = state.status === "downloading" || state.status === "restarting";

  return (
    <>
      <button
        type="button"
        className="update-pill"
        onClick={() => setOpen(true)}
        title={version ? s.available(version) : s.title}
        data-testid="update-button"
      >
        <span className="update-pill__dot" aria-hidden="true" />
        <ArrowDownToLine aria-hidden="true" />
        <span>{busy ? s.updating : s.button}</span>
      </button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        dismissible={!busy}
        size="sm"
        title={version ? s.dialogTitle(version) : s.title}
        description={s.dialogHint}
        footer={(
          <>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>{s.later}</Button>
            <Button
              variant="primary"
              icon={state.status === "error" ? <RefreshCcw /> : <ArrowDownToLine />}
              loading={busy}
              onClick={() => void update.install()}
              data-testid="update-install"
            >
              {state.status === "error" ? s.retry : s.install}
            </Button>
          </>
        )}
      >
        <div className="update-sheet">
          {notes.trim() ? (
            <section className="update-sheet__notes" aria-label={s.notesLabel}>
              <h3>{s.notesLabel}</h3>
              <p>{notes.trim()}</p>
            </section>
          ) : null}
          {state.status === "downloading" ? (
            <ProgressBar
              label={s.downloading}
              value={state.percent ?? 0}
              indeterminate={state.percent === null}
            />
          ) : null}
          {state.status === "restarting" ? <p className="update-sheet__status" role="status">{s.restarting}</p> : null}
          {state.status === "error" ? (
            <Banner tone="danger" title={s.failed}>{state.message}</Banner>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
