import { X } from "lucide-react";
import type { SourceRequest } from "../../services/sourceRequests";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button, IconButton, ProgressBar, Switch } from "../../ui";
import { formatRelativeSync } from "./lastSync";
import { SourceIcon } from "./SourceIcon";

const strings = sourcesStrings.request;

/** Texto da etapa: a fila mostra a posição; falha e recusa mostram o motivo. */
export function requestStageText(request: SourceRequest): string {
  if (request.status === "queued" && request.queuePosition) return strings.queue(request.queuePosition);
  if ((request.status === "failed" || request.status === "rejected") && request.message) return `${request.stageLabel}: ${request.message}`;
  return request.stageLabel;
}

export type PendingSourceRowProps = {
  request: SourceRequest;
  /** Fonte pronta mas que ainda não está na lista: traz do índice, ativa e sincroniza. */
  onAdd?: (sourceId: string) => void;
  adding?: boolean;
  onDismiss: (id: string) => void;
};

/** Uma fonte pedida que ainda não existe: ocupa uma linha da tabela até virar fonte de verdade. */
export function PendingSourceRow({ request, onAdd, adding = false, onDismiss }: PendingSourceRowProps) {
  const ended = request.status === "failed" || request.status === "rejected";
  const ready = request.status === "live";
  const tone = ended ? "danger" : ready ? "success" : "accent";
  const badge = request.status === "failed" ? strings.failed : request.status === "rejected" ? strings.rejected : ready ? strings.ready : strings.building;
  const requested = formatRelativeSync(request.createdAt);
  const baseUrl = `https://${request.domain}/`;
  return (
    <tr className={`sources-table__row sources-table__row--pending${ended ? " is-ended" : ""}`} data-testid="pending-source-row" data-status={request.status}>
      <th scope="row" className="sources-table__source">
        <div className="sources-table__identity">
          <SourceIcon sourceId={request.sourceId ?? request.domain} baseUrl={baseUrl} name={request.domain} size="lg" muted={!ready} />
          <div className="sources-table__names">
            <span className="sources-table__name">
              <span className="sources-table__name-text">{request.domain}</span>
              <Badge tone={tone} data-testid="pending-source-badge">{badge}</Badge>
            </span>
            <span className="sources-table__pending-stage" data-testid="pending-source-stage">{requestStageText(request)}</span>
            {!ended && request.stageIndex ? (
              <ProgressBar
                size="sm"
                value={request.stageIndex}
                max={request.stagesTotal}
                tone={ready ? "success" : "accent"}
                label={strings.stepOf(request.stageIndex, request.stagesTotal)}
                className="sources-table__pending-progress"
              />
            ) : null}
            {request.novelTitle ? <span className="sources-table__domain">{strings.novel(request.novelTitle)}</span> : null}
          </div>
        </div>
      </th>
      <td className="sources-table__cell sources-table__cell--language">—</td>
      <td className="sources-table__cell sources-table__cell--number">—</td>
      <td className="sources-table__cell sources-table__cell--sync" title={requested.title}>{strings.requested(requested.label.toLowerCase())}</td>
      <td className="sources-table__cell sources-table__cell--switch">
        <Switch className="sources-table__switch" label={<span className="sr-only">{sourcesStrings.include} ({request.domain})</span>} checked={false} disabled onChange={() => undefined} />
      </td>
      <td className="sources-table__cell sources-table__cell--actions">
        <div className="sources-table__actions">
          {ready && request.sourceId && onAdd ? (
            <Button size="sm" variant="primary" loading={adding} onClick={() => onAdd(request.sourceId as string)}>{strings.addAndSync}</Button>
          ) : null}
          {ended ? <IconButton size="sm" icon={<X />} label={strings.dismiss} onClick={() => onDismiss(request.id)} /> : null}
        </div>
      </td>
    </tr>
  );
}
