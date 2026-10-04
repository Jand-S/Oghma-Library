import { X } from "lucide-react";
import { sourcesStrings } from "../../strings/sources";
import { Button, IconButton } from "../../ui";

/**
 * "Adicionar e sincronizar" across the switch and actions columns, so the wide button never covers
 * the switch. With `onDismiss`, an X beside it takes the request off the list (a source the user
 * does not want, or one taken out of the catalog).
 */
export function AddSourceCell({ loading, onAdd, onDismiss }: { loading: boolean; onAdd: () => void; onDismiss?: () => void }) {
  return (
    <td className="sources-table__cell sources-table__cell--add" colSpan={2}>
      <div className="sources-table__actions">
        <Button size="sm" variant="primary" loading={loading} onClick={onAdd} data-testid="source-add">{sourcesStrings.request.addAndSync}</Button>
        {onDismiss ? (
          <IconButton size="sm" icon={<X />} label={sourcesStrings.request.dismiss} onClick={onDismiss} data-testid="pending-source-dismiss" />
        ) : null}
      </div>
    </td>
  );
}
