import { useMemo, useState, type ReactNode } from "react";
import { ExternalLink, Globe2, RefreshCcw, Search, Settings } from "lucide-react";
import type { Novel, SourceSite } from "../../core/types";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button, cx, EmptyState, IconButton, Panel, Skeleton, Switch, TextField } from "../../ui";
import { openExternal } from "../settings/appInfo";
import { formatRelativeSync } from "./lastSync";
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
};

/** A search field appears above the list past this many sources. */
export const SOURCES_SEARCH_THRESHOLD = 8;

const tldLanguages: Record<string, string> = { br: "PT-BR", pt: "PT", es: "ES", jp: "JA", kr: "KO", cn: "ZH", fr: "FR", de: "DE" };

/** Catalog language of the known connectors (backend `scraper/connectors`). */
const knownLanguages: Record<string, string> = {
  "central-novel": "PT-BR",
  "house-saikai": "PT-BR",
  "mahou-reader": "PT-BR",
  "novel-mania": "PT-BR",
  "golden-novel": "EN",
  "light-novel-pub": "EN",
  "rolia-scan": "EN",
  "sky-demon-order": "EN"
};

/** Most common language among the source's loaded novels, else the connector's, else a guess from the domain. */
export function sourceLanguage(source: SourceSite, novels: readonly Novel[] = []) {
  const counts = new Map<string, number>();
  for (const novel of novels) {
    if (novel.sourceId !== source.id || !novel.language) continue;
    const key = novel.language.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  if (knownLanguages[source.id]) return knownLanguages[source.id];
  const tld = sourceDomain(source.baseUrl).split(".").pop()?.toLowerCase() ?? "";
  return tldLanguages[tld] ?? sourcesStrings.unknownLanguage;
}

const normalize = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

function SourceRow({ source, syncing, language, onToggle, onSync, onOpenSite }: {
  source: SourceSite;
  syncing: boolean;
  language: string;
  onToggle: () => void;
  onSync: () => void;
  onOpenSite: () => void;
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
          <SourceIcon sourceId={source.id} baseUrl={source.baseUrl} name={source.name} size="lg" muted={!source.enabled} />
          <div className="sources-table__names">
            <span className="sources-table__name">
              <span className="sources-table__name-text">{source.name}</span>
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
  onOpenSite = (url) => void openExternal(url)
}: SourcesViewProps) {
  const [query, setQuery] = useState("");
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
          />
        ))}
        {visible.length === 0 ? (
          <tr>
            <td className="sources-table__no-match" colSpan={6}>{sourcesStrings.noMatches(trimmed)}</td>
          </tr>
        ) : null}
      </SourcesTable>
    </div>
  );
}
