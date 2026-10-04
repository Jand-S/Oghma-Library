import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Globe2, Plus, RefreshCcw, Search, Settings } from "lucide-react";
import type { Novel, SourceSite } from "../../core/types";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button, cx, EmptyState, IconButton, Panel, Skeleton, Switch, TextField } from "../../ui";
import { openExternal } from "../settings/appInfo";
import { formatRelativeSync } from "./lastSync";
import { AddSourceCell } from "./AddSourceCell";
import { PendingSourceRow } from "./PendingSourceRow";
import { RequestSourceDialog } from "./RequestSourceDialog";
import { useSourceRequests } from "./useSourceRequests";
import { SourceIcon } from "./SourceIcon";
import { sourceDomain } from "./sourceIcons";
import "./sources.css";

export { sourceDomain } from "./sourceIcons";
export { SourceIcon, type SourceIconProps } from "./SourceIcon";

export type SourcesViewProps = {
  sources: SourceSite[];
  syncing: string[];
  loading?: boolean;
  /** Loaded novels, used to tell each source's language. */
  novels?: Novel[];
  onToggle: (id: string) => void;
  onSync: (id: string) => void;
  onOpenSettings: () => void;
  /** Opens the source's site; defaults to the system browser (opener plugin in Tauri). */
  onOpenSite?: (url: string) => void;
  /** Fonte nova de um pedido: traz do índice, ativa e sincroniza. */
  onAddSource?: (sourceId: string) => Promise<void> | void;
  /** Lê só o índice (sem catálogos): idioma, contagem e ícone de uma fonte pronta que ainda não foi adicionada. */
  onPeekSources?: () => Promise<SourceSite[]>;
  /** Toast curto do app. */
  onNotify?: (message: string) => void;
  /** Pedidos de fonte; injetável nos testes. */
  sourceRequests?: ReturnType<typeof useSourceRequests>;
  /**
   * "Solicitar nova fonte" dialog, controlled by the app (its button lives in the page header).
   * Without these props the view shows its own button above the list.
   */
  requestOpen?: boolean;
  onRequestOpenChange?: (open: boolean) => void;
};

/** Com pedidos injetados (testes), o hook próprio não busca nada. */
const INJECTED_REQUESTS = { list: async () => [], refreshMs: 24 * 60 * 60 * 1000 };

/** A search field appears above the list past this many sources. */
export const SOURCES_SEARCH_THRESHOLD = 8;

const tldLanguages: Record<string, string> = { br: "PT-BR", pt: "PT", es: "ES", jp: "JA", kr: "KO", cn: "ZH", fr: "FR", de: "DE" };

/** The language published with the source, else the most common among its loaded novels, else a guess from the domain. */
export function sourceLanguage(source: SourceSite, novels: readonly Novel[] = []) {
  if (source.language) return source.language.toUpperCase();
  const counts = new Map<string, number>();
  for (const novel of novels) {
    if (novel.sourceId !== source.id || !novel.language) continue;
    const key = novel.language.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  const tld = sourceDomain(source.baseUrl).split(".").pop()?.toLowerCase() ?? "";
  return tldLanguages[tld] ?? sourcesStrings.unknownLanguage;
}

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function SourceRow({ source, syncing, language, onToggle, onSync, onOpenSite, isNew = false, onAdd }: {
  source: SourceSite;
  syncing: boolean;
  language: string;
  onToggle: () => void;
  onSync: () => void;
  onOpenSite: () => void;
  /** Fonte recém-criada a partir de um pedido. */
  isNew?: boolean;
  onAdd?: () => void;
}) {
  const domain = sourceDomain(source.baseUrl);
  const lastSync = formatRelativeSync(source.lastSync);
  // Only states worth a glance get a badge; "online" is the normal case.
  const status = syncing || source.status === "syncing" ? "syncing" : source.status === "offline" && source.enabled ? "offline" : null;
  return (
    <tr
      className={cx("sources-table__row", !source.enabled && "sources-table__row--disabled")}
      data-testid="source-row"
      data-enabled={source.enabled}
    >
      <th scope="row" className="sources-table__source">
        <div className="sources-table__identity">
          <SourceIcon sourceId={source.id} baseUrl={source.baseUrl} iconUrl={source.iconUrl} name={source.name} size="lg" muted={!source.enabled} />
          <div className="sources-table__names">
            <span className="sources-table__name">
              <span className="sources-table__name-text">{source.name}</span>
              {isNew ? <Badge tone="success" data-testid="source-new">{sourcesStrings.request.ready}</Badge> : null}
              {status ? (
                <Badge tone={status === "offline" ? "danger" : "accent"} data-testid="source-status">
                  {sourcesStrings.status[status]}
                </Badge>
              ) : null}
            </span>
            <span className="sources-table__domain" title={source.baseUrl}>{domain}</span>
          </div>
        </div>
      </th>
      <td className="sources-table__cell sources-table__cell--language">{language}</td>
      <td className="sources-table__cell sources-table__cell--number">{source.count.toLocaleString("pt-BR")}</td>
      <td className="sources-table__cell sources-table__cell--sync" title={lastSync.title}>{lastSync.label}</td>
      {isNew && !source.enabled && onAdd ? (
        // Adicionar = ligar e sincronizar: o botão ocupa o lugar do switch, que aqui seria redundante.
        <AddSourceCell loading={syncing} onAdd={onAdd} />
      ) : (
        <>
          <td className="sources-table__cell sources-table__cell--switch">
            <Switch
              className="sources-table__switch"
              label={<span className="sr-only">{sourcesStrings.include} ({source.name})</span>}
              checked={source.enabled}
              onChange={onToggle}
            />
          </td>
          <td className="sources-table__cell sources-table__cell--actions">
            <div className="sources-table__actions">
              <IconButton size="sm" icon={<RefreshCcw />} label={sourcesStrings.syncSource(source.name)} loading={syncing} onClick={onSync} />
              <IconButton size="sm" icon={<ExternalLink />} label={sourcesStrings.openSiteOf(source.name)} onClick={onOpenSite} />
            </div>
          </td>
        </>
      )}
    </tr>
  );
}

function SourcesTable({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <Panel className="sources-panel">
      <table className="sources-table" aria-label={sourcesStrings.listLabel} aria-busy={busy || undefined}>
        <colgroup>
          <col />
          <col className="sources-table__col--language" />
          <col className="sources-table__col--number" />
          <col className="sources-table__col--sync" />
          <col className="sources-table__col--switch" />
          <col className="sources-table__col--actions" />
        </colgroup>
        <thead>
          <tr className="sources-table__head">
            <th scope="col">{sourcesStrings.columns.source}</th>
            <th scope="col">{sourcesStrings.columns.language}</th>
            <th scope="col" className="sources-table__cell--number">{sourcesStrings.columns.books}</th>
            <th scope="col">{sourcesStrings.columns.lastSync}</th>
            <th scope="col" className="sources-table__cell--switch">{sourcesStrings.columns.include}</th>
            <th scope="col"><span className="sr-only">{sourcesStrings.columns.actions}</span></th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </Panel>
  );
}

export function SourcesView({
  sources,
  syncing,
  loading = false,
  novels = [],
  onToggle,
  onSync,
  onOpenSettings,
  onOpenSite = (url) => void openExternal(url),
  onAddSource,
  onPeekSources,
  onNotify,
  sourceRequests,
  requestOpen: controlledRequestOpen,
  onRequestOpenChange
}: SourcesViewProps) {
  const [query, setQuery] = useState("");
  const [ownRequestOpen, setOwnRequestOpen] = useState(false);
  const requestControlled = onRequestOpenChange !== undefined;
  const requestOpen = requestControlled ? Boolean(controlledRequestOpen) : ownRequestOpen;
  const setRequestOpen = requestControlled ? onRequestOpenChange : setOwnRequestOpen;
  const ownRequests = useSourceRequests(sourceRequests ? INJECTED_REQUESTS : undefined);
  const requests = sourceRequests ?? ownRequests;
  const knownIds = useMemo(() => new Set(sources.map((source) => source.id)), [sources]);
  // Fonte que já virou fonte de verdade sai das linhas de pedido e ganha o destaque "Nova".
  const newSourceIds = useMemo(
    () => new Set(requests.requests.filter((r) => r.status === "live" && r.sourceId && knownIds.has(r.sourceId)).map((r) => r.sourceId as string)),
    [requests.requests, knownIds]
  );
  const pending = requests.requests.filter((r) => !(r.status === "live" && r.sourceId && knownIds.has(r.sourceId)));
  // Fonte pronta mas ainda fora da lista: lê só o índice para mostrar idioma, contagem e ícone na linha do pedido.
  const [indexSources, setIndexSources] = useState<Record<string, SourceSite>>({});
  const readyIds = pending.filter((r) => r.status === "live" && r.sourceId).map((r) => r.sourceId as string);
  const missingKey = readyIds.filter((id) => !indexSources[id]).sort().join(",");
  useEffect(() => {
    if (!missingKey || !onPeekSources) return;
    let alive = true;
    onPeekSources()
      .then((items) => {
        if (alive) setIndexSources((current) => ({ ...current, ...Object.fromEntries(items.map((item) => [item.id, item])) }));
      })
      .catch(() => undefined); // sem índice a linha fica como está ("—")
    return () => { alive = false; };
  }, [missingKey, onPeekSources]);
  const addSource = (sourceId: string) => void onAddSource?.(sourceId);
  const showSearch = sources.length > SOURCES_SEARCH_THRESHOLD;
  const trimmed = showSearch ? query.trim() : "";
  const visible = useMemo(() => {
    if (!trimmed) return sources;
    const needle = normalize(trimmed);
    return sources.filter((source) => normalize(`${source.name} ${sourceDomain(source.baseUrl)}`).includes(needle));
  }, [sources, trimmed]);

  if (loading && sources.length === 0) {
    return (
      <div className="o-page o-page--narrow sources-page" aria-label={sourcesStrings.loading}>
        <SourcesTable busy>
          {[0, 1, 2, 3].map((index) => (
            <tr className="sources-table__row" key={index} data-testid="source-skeleton">
              <td className="sources-table__source">
                <div className="sources-table__identity">
                  <Skeleton width="var(--control-sm)" height="var(--control-sm)" radius="var(--radius-md)" />
                  <div className="sources-table__names">
                    <Skeleton width="40%" height="var(--fs-md)" />
                    <Skeleton width="25%" height="var(--fs-xs)" />
                  </div>
                </div>
              </td>
              <td className="sources-table__cell"><Skeleton width="var(--space-4)" height="var(--fs-sm)" /></td>
              <td className="sources-table__cell"><Skeleton width="var(--space-4)" height="var(--fs-sm)" /></td>
              <td className="sources-table__cell"><Skeleton width="var(--space-8)" height="var(--fs-sm)" /></td>
              <td className="sources-table__cell"><Skeleton width="calc(var(--icon-md) * 2)" height="var(--icon-md)" /></td>
              <td className="sources-table__cell" />
            </tr>
          ))}
        </SourcesTable>
      </div>
    );
  }

  if (sources.length === 0) {
    return (
      <div className="o-app__center">
        <EmptyState
          icon={<Globe2 />}
          title={sourcesStrings.emptyTitle}
          description={sourcesStrings.emptyDescription}
          action={<Button variant="primary" icon={<Settings />} onClick={onOpenSettings}>{sourcesStrings.openSettings}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="o-page o-page--narrow sources-page" data-testid="sources-page">
      {requestControlled ? null : (
        <div className="sources-toolbar">
          <Button size="sm" variant="outline" icon={<Plus />} onClick={() => setRequestOpen(true)} data-testid="request-source-open">
            {sourcesStrings.request.open}
          </Button>
        </div>
      )}
      <RequestSourceDialog open={requestOpen} onClose={() => setRequestOpen(false)} onSubmit={requests.submit} onSent={onNotify} />
      {showSearch ? (
        <TextField
          type="search"
          label={sourcesStrings.search}
          hideLabel
          placeholder={sourcesStrings.searchPlaceholder}
          leading={<Search />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          fieldClassName="sources-search"
        />
      ) : null}
      <SourcesTable>
        {visible.map((source) => (
          <SourceRow
            key={source.id}
            source={source}
            syncing={syncing.includes(source.id)}
            language={sourceLanguage(source, novels)}
            onToggle={() => onToggle(source.id)}
            onSync={() => onSync(source.id)}
            onOpenSite={() => onOpenSite(source.baseUrl)}
            isNew={newSourceIds.has(source.id)}
            onAdd={() => addSource(source.id)}
          />
        ))}
        {pending.map((request) => (
          <PendingSourceRow
            key={request.id}
            request={request}
            site={request.sourceId ? indexSources[request.sourceId] : undefined}
            onAdd={onAddSource ? addSource : undefined}
            adding={Boolean(request.sourceId && syncing.includes(request.sourceId))}
            onDismiss={requests.dismiss}
          />
        ))}
        {visible.length === 0 && pending.length === 0 ? (
          <tr>
            <td className="sources-table__no-match" colSpan={6}>{sourcesStrings.noMatches(trimmed)}</td>
          </tr>
        ) : null}
      </SourcesTable>
    </div>
  );
}
