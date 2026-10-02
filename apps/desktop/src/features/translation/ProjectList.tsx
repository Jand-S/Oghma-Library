import { CheckCircle2, Plus } from "lucide-react";
import type { LibraryItem } from "../../core/types";
import type { ProjectSummary } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, Cover, ProgressBar } from "../../ui";
import { formatPercent, statusTone } from "./translationFormat";

/** Cover of a project: the engine's, else the source book's in the library. */
export function projectCover(project: ProjectSummary, library: LibraryItem[]) {
  if (project.coverUrl) return project.coverUrl;
  return library.find((item) => (project.sourceNovelId && item.novelId === project.sourceNovelId) || item.title === project.title)?.coverUrl;
}

type ProjectListProps = {
  projects: ProjectSummary[];
  library: LibraryItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  onTranslateBook: () => void;
};

/** Left column: books being translated, with status, % and "PT-BR pronto". */
export function ProjectList({ projects, library, selectedId, onSelect, onTranslateBook }: ProjectListProps) {
  return (
    <section className="translation-projects" aria-labelledby="translation-projects-title">
      <header className="translation-projects__header">
        <h2 id="translation-projects-title" className="translation-projects__title">{t.projectsHeading}</h2>
        <Button size="sm" variant="primary" icon={<Plus />} onClick={onTranslateBook}>{t.translateBook}</Button>
      </header>
      <ul className="translation-projects__list" aria-label={t.projectList}>
        {projects.map((project) => {
          const percent = Math.max(0, Math.min(100, project.percent));
          const exported = project.status === "exported";
          return (
            <li key={project.id}>
              <button
                type="button"
                className="translation-project"
                aria-pressed={project.id === selectedId}
                data-testid="translation-project"
                data-status={project.status}
                onClick={() => onSelect(project.id)}
              >
                <Cover size="sm" src={projectCover(project, library)} title={project.title} className="translation-project__cover" />
                <span className="translation-project__body">
                  <span className="translation-project__title">{project.title}</span>
                  <span className="translation-project__meta">
                    {exported ? (
                      <Badge tone="success" className="translation-project__ready">
                        <CheckCircle2 aria-hidden="true" />
                        {t.ptBrReady}
                      </Badge>
                    ) : (
                      <Badge tone={statusTone[project.status]}>{t.status[project.status]}</Badge>
                    )}
                    <span className="translation-project__percent">{formatPercent(percent)}%</span>
                  </span>
                  <ProgressBar
                    size="sm"
                    label={t.projectProgress(project.title)}
                    value={percent}
                    tone={project.status === "error" ? "danger" : project.status === "done" || exported ? "success" : "accent"}
                    className={project.status === "paused" || project.status === "waiting_limit" ? "translation-bar--warn" : undefined}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
