import { X } from "lucide-react";
import type { SourceSite } from "../../core/types";
import type { SourceRequest } from "../../services/sourceRequests";
import { sourcesStrings } from "../../strings/sources";
import { Badge, IconButton, ProgressBar, Switch } from "../../ui";
import { formatRelativeSync } from "./lastSync";
import { SourceIcon } from "./SourceIcon";
import { AddSourceCell } from "./AddSourceCell";

const strings = sourcesStrings.request;

/** Texto da etapa: a fila mostra a posição; falha e recusa mostram o motivo. */
export function requestStageText(request: SourceRequest): string {
  // Esperando a vez da construção: a mensagem já traz quando volta ("Na fila: a construção retoma às 14:30").
  if (request.stage === "waiting_plan") return request.message || request.stageLabel;
  if (request.status === "queued" && request.queuePosition) return strings.queue(request.queuePosition);
  // Falha e recusa: a frase já vem pronta para quem pediu (os detalhes técnicos ficam no brain).
  if ((request.status === "failed" || request.status === "rejected") && request.message) return request.message;
  return request.stageLabel;
}

export type PendingSourceRowProps = {
  request: SourceRequest;
  /** A fonte como está no índice, quando o pedido já virou fonte publicada (idioma, contagem, ícone). */
  site?: SourceSite;
  /** Fonte pronta mas que ainda não está na lista: traz do índice, ativa e sincroniza. */
  onAdd?: (sourceId: string) => void;
  adding?: boolean;
  onDismiss: (id: string) => void;
};

/** Uma fonte pedida que ainda não existe: ocupa uma linha da tabela até virar fonte de verdade. */
export function PendingSourceRow({ request, site, onAdd, adding = false, onDismiss }: PendingSourceRowProps) {
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
          <SourceIcon sourceId={request.sourceId ?? request.domain} baseUrl={baseUrl} iconUrl={site?.iconUrl} name={site?.name ?? request.domain} size="lg" muted={!ready} />
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
      <td className="sources-table__cell sources-table__cell--language" data-testid="pending-source-language">{site?.language ?? "—"}</td>
      <td className="sources-table__cell sources-table__cell--number">{site ? site.count.toLocaleString("pt-BR") : "—"}</td>
      <td className="sources-table__cell sources-table__cell--sync" title={requested.title}>{strings.requested(requested.label.toLowerCase())}</td>
      {ready && request.sourceId && onAdd ? (
        <AddSourceCell loading={adding} onAdd={() => onAdd(request.sourceId as string)} />
      ) : (
        <>
          <td className="sources-table__cell sources-table__cell--switch">
            <Switch className="sources-table__switch" label={<span className="sr-only">{sourcesStrings.include} ({request.domain})</span>} checked={false} disabled onChange={() => undefined} />
          </td>
          <td className="sources-table__cell sources-table__cell--actions">
            <div className="sources-table__actions">
              {ended ? <IconButton size="sm" icon={<X />} label={strings.dismiss} onClick={() => onDismiss(request.id)} /> : null}
            </div>
          </td>
        </>
      )}
    </tr>
  );
}
