import { SearchX, Search } from "lucide-react";
import { useMemo } from "react";
import type { LibraryItem } from "../../core/types";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, Cover, cx, EmptyState, Panel, ProgressBar, SelectField, TextField } from "../../ui";
import { formatOptions, hasFormat, matchesQuery, projectStatus, type FormatFilter, type TranslationSessionItem } from "./translationModel";
import type { TranslationController } from "./useTranslationController";

function ProjectCard({ item, selected, batches, onSelect }: {
  item: LibraryItem;
  selected: boolean;
  batches: TranslationSessionItem[];
  onSelect: () => void;
}) {
  const status = projectStatus(batches);
  return (
    <li>
      <button
        type="button"
        className={cx("translation-project", selected && "is-selected")}
        aria-pressed={selected}
        data-testid="translation-project"
        onClick={onSelect}
      >
        <Cover src={item.coverUrl} title={item.title} size="sm" />
        <span className="translation-project__body">
          <span className="translation-project__title">{item.title}</span>
          <span className="translation-project__meta">
            {item.chapters ? t.chapters(item.chapters) : t.localSize(item.sizeMb)}
            {batches.length === 0 ? ` · ${status.label}` : null}
          </span>
          {batches.length ? (
            <span className="translation-project__status">
              <Badge tone={status.tone}>{status.label}</Badge>
              {status.progress !== null ? <span className="translation-project__percent">{Math.round(status.progress)}%</span> : null}
            </span>
          ) : null}
          {status.progress !== null ? (
            <ProgressBar size="sm" label={t.projectProgress(item.title)} value={status.progress} />
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function ProjectList({ controller }: { controller: TranslationController }) {
  const { library, query, setQuery, format, setFormat, selectedId, selectProject, sessionItems } = controller;
  const filtered = useMemo(
    () => library.filter((item) => matchesQuery(item, query) && hasFormat(item, format)),
    [format, library, query]
  );
  const batchesByProject = useMemo(() => {
    const map = new Map<string, TranslationSessionItem[]>();
    for (const item of sessionItems) map.set(item.projectId, [...(map.get(item.projectId) ?? []), item]);
    return map;
  }, [sessionItems]);
  const filtering = query.trim().length > 0 || format !== "all";
  const clearFilters = () => {
    setQuery("");
    setFormat("all");
  };

  return (
    <Panel className="translation-projects" title={t.projectsHeading} description={t.projectsDescription}>
      <div className="translation-projects__filters">
        <TextField
          label={t.searchProjects}
          hideLabel
          placeholder={t.searchProjects}
          leading={<Search />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <SelectField<FormatFilter>
          label={t.formatFilter}
          hideLabel
          value={format}
          options={formatOptions.map((option) => ({ value: option, label: option === "all" ? t.allFormats : option }))}
          onChange={(event) => setFormat(event.target.value as FormatFilter)}
        />
      </div>
      <div className="translation-projects__count">
        <span>{t.projectCount(filtered.length, library.length)}</span>
        {filtering && filtered.length > 0 ? <Button size="sm" variant="ghost" onClick={clearFilters}>{t.clearFilters}</Button> : null}
      </div>
      {filtered.length === 0 ? (
        <EmptyState
          className="translation-empty--compact"
          icon={<SearchX />}
          title={t.noMatchTitle}
          description={t.noMatchDescription}
          action={<Button size="sm" onClick={clearFilters}>{t.clearFilters}</Button>}
        />
      ) : (
        <ul className="translation-projects__list" aria-label={t.projectList}>
          {filtered.map((item) => (
            <ProjectCard
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              batches={batchesByProject.get(item.id) ?? []}
              onSelect={() => selectProject(item.id)}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
