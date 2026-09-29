import { Globe2, RefreshCcw, Settings } from "lucide-react";
import type { Novel, SourceSite } from "../../core/types";
import { sourceModeLabels } from "../../strings/settings";
import { sourcesStrings } from "../../strings/sources";
import { Badge, Button, cx, EmptyState, Skeleton, Switch, type BadgeTone } from "../../ui";
import "./sources.css";

export type SourcesViewProps = {
  sources: SourceSite[];
  syncing: string[];
  loading?: boolean;
  /** Loaded novels, used to tell each source's language. */
  novels?: Novel[];
  onToggle: (id: string) => void;
  onSync: (id: string) => void;
  onOpenSettings: () => void;
};

/** "https://www.centralnovel.com/" → "centralnovel.com". */
export function sourceDomain(baseUrl: string) {
  try {
    return new URL(baseUrl).host.replace(/^www\./, "");
  } catch {
    return baseUrl.replace(/^[a-z]+:\/\//i, "").replace(/\/+$/, "");
  }
}

const tldLanguages: Record<string, string> = { br: "PT-BR", pt: "PT", es: "ES", jp: "JA", kr: "KO", cn: "ZH", fr: "FR", de: "DE" };

/** Most common language among the source's loaded novels, else a guess from the domain. */
export function sourceLanguage(source: SourceSite, novels: readonly Novel[] = []) {
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

const statusTone: Record<SourceSite["status"], BadgeTone> = { online: "success", syncing: "accent", offline: "danger" };

function SourceCard({ source, syncing, language, onToggle, onSync }: {
  source: SourceSite;
  syncing: boolean;
  language: string;
  onToggle: () => void;
  onSync: () => void;
}) {
  const domain = sourceDomain(source.baseUrl);
  const status = syncing ? "syncing" : source.status;
  return (
    <article
      className={cx("sources-card", !source.enabled && "sources-card--disabled")}
      data-testid="source-card"
      data-enabled={source.enabled}
      aria-labelledby={`source-${source.id}-name`}
    >
      <header className="sources-card__head">
        <span className="sources-card__avatar" aria-hidden="true">{source.name.slice(0, 1).toUpperCase()}</span>
        <div className="sources-card__title">
          <h2 className="sources-card__name" id={`source-${source.id}-name`}>{source.name}</h2>
          <span className="sources-card__domain" title={source.baseUrl}>{domain}</span>
        </div>
        <Badge tone={source.enabled ? statusTone[status] : "neutral"} data-testid="source-status">
          {source.enabled ? sourcesStrings.status[status] : sourcesStrings.disabled}
        </Badge>
      </header>

      <dl className="sources-card__meta">
        <div>
          <dt>{sourcesStrings.language}</dt>
          <dd>{language}</dd>
        </div>
        <div>
          <dt>{sourcesStrings.books}</dt>
          <dd>{source.count.toLocaleString("pt-BR")}</dd>
        </div>
        <div>
          <dt>{sourcesStrings.lastSync}</dt>
          <dd>{source.lastSync || "—"}</dd>
        </div>
        <div>
          <dt>{sourcesStrings.mode}</dt>
          <dd>{sourceModeLabels[source.mode]}</dd>
        </div>
      </dl>

      <footer className="sources-card__foot">
        <Switch
          className="sources-card__switch"
          label={<>{sourcesStrings.include}<span className="sr-only"> ({source.name})</span></>}
          checked={source.enabled}
          onChange={onToggle}
        />
        <Button
          size="sm"
          variant="ghost"
          icon={<RefreshCcw />}
          loading={syncing}
          onClick={onSync}
          aria-label={sourcesStrings.syncSource(source.name)}
        >
          {sourcesStrings.sync}
        </Button>
      </footer>
    </article>
  );
}

export function SourcesView({ sources, syncing, loading = false, novels = [], onToggle, onSync, onOpenSettings }: SourcesViewProps) {
  if (loading && sources.length === 0) {
    return (
      <div className="o-page o-page--narrow sources-page" aria-busy="true" aria-label={sourcesStrings.loading}>
        <div className="sources-grid">
          {[0, 1, 2].map((index) => (
            <div className="sources-card" key={index}>
              <Skeleton height="var(--control-md)" width="60%" />
              <Skeleton height="var(--space-8)" />
              <Skeleton height="var(--control-sm)" width="40%" />
            </div>
          ))}
        </div>
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
      <p className="sources-lead">{sourcesStrings.lead}</p>
      <div className="sources-grid">
        {sources.map((source) => (
          <SourceCard
            key={source.id}
            source={source}
            syncing={syncing.includes(source.id)}
            language={sourceLanguage(source, novels)}
            onToggle={() => onToggle(source.id)}
            onSync={() => onSync(source.id)}
          />
        ))}
      </div>
    </div>
  );
}
