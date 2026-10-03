import { useState, type FormEvent } from "react";
import { getErrorMessage } from "../../services/backendClient";
import { normalizeRequestUrl, savedRequester, type NewSourceRequest, type SourceRequest } from "../../services/sourceRequests";
import { sourcesStrings } from "../../strings/sources";
import { Button, Modal, TextField } from "../../ui";

const strings = sourcesStrings.request;

export type RequestSourceDialogProps = {
  open: boolean;
  onClose: () => void;
  onSubmit: (input: NewSourceRequest) => Promise<SourceRequest>;
  /** Mensagem curta depois de enviar (toast do app). */
  onSent?: (message: string) => void;
};

export function RequestSourceDialog({ open, onClose, onSubmit, onSent }: RequestSourceDialogProps) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState(savedRequester);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!normalizeRequestUrl(url)) {
      setError(strings.invalidUrl);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const created = await onSubmit({ url, note: note.trim(), requester: name.trim() });
      onSent?.(created.duplicate ? strings.duplicate(created.domain) : strings.sent);
      setUrl("");
      setNote("");
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, strings.unavailable));
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!sending}
      title={strings.title}
      description={strings.description}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={sending}>{strings.cancel}</Button>
          <Button variant="primary" type="submit" form="request-source-form" loading={sending}>{strings.submit}</Button>
        </>
      )}
    >
      <form id="request-source-form" className="request-source" onSubmit={(event) => void submit(event)} data-testid="request-source-form">
        <TextField
          label={strings.urlLabel}
          placeholder={strings.urlPlaceholder}
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          error={error ?? undefined}
          autoFocus
          inputMode="url"
        />
        <TextField label={strings.nameLabel} value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
        <TextField label={strings.noteLabel} placeholder={strings.notePlaceholder} value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} />
      </form>
    </Modal>
  );
}
