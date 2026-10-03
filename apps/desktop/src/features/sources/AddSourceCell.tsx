import { sourcesStrings } from "../../strings/sources";
import { Button } from "../../ui";

/** "Adicionar e sincronizar" across the switch and actions columns, so the wide button never covers the switch. */
export function AddSourceCell({ loading, onAdd }: { loading: boolean; onAdd: () => void }) {
  return (
    <td className="sources-table__cell sources-table__cell--add" colSpan={2}>
      <div className="sources-table__actions">
        <Button size="sm" variant="primary" loading={loading} onClick={onAdd} data-testid="source-add">{sourcesStrings.request.addAndSync}</Button>
      </div>
    </td>
  );
}
