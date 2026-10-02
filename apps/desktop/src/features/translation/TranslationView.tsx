import { CloudOff, Languages, Monitor, MoreHorizontal, Plus, RefreshCcw, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { modelLabel, translationStrings as t } from "../../strings/translation";
import { Badge, Button, ConfirmationModal, Cover, DropdownMenu, EmptyState, IconButton, SegmentedControl, Skeleton } from "../../ui";
import { AccountStrip, LimitBanner } from "./AccountStrip";
import { BookPickerModal } from "./BookPickerModal";
import { GlossaryTab } from "./GlossaryTab";
import { PilotTab } from "./PilotTab";
import { ProgressTab } from "./ProgressTab";
import { projectCover, ProjectList } from "./ProjectList";
import { ProjectSettingsModal } from "./ProjectSettingsModal";
import { ReviewTab } from "./ReviewTab";
import { statusTone } from "./translationFormat";
import type { TranslationController, TranslationTab } from "./useTranslationController";
import "./translation.css";

type TranslationViewProps = {
  controller: TranslationController;
  onBrowse: () => void;
};

function Workspace({ controller }: { controller: TranslationController }) {
  const project = controller.selected;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!project) {
    return (
      <section className="translation-main" aria-busy="true">
        <div className="translation-head">
          <Skeleton width={48} height={72} radius={4} />
          <div className="translation-head__text">
            <Skeleton width="50%" height={20} />
            <Skeleton width="35%" height={14} />
          </div>
        </div>
      </section>
    );
  }

  const tab = controller.tab;
  const cover = projectCover(project, controller.library);

  return (
    <section className="translation-main" aria-labelledby="translation-project-title" data-testid="translation-workspace">
      <header className="translation-head">
        <Cover size="sm" src={cover} title={project.title} />
        <div className="translation-head__text">
          <h2 className="translation-head__title" id="translation-project-title">{project.title}</h2>
          <p className="translation-head__meta">{t.projectMeta(project.chaptersTotal, modelLabel(project.model), project.workers)}</p>
        </div>
        <Badge tone={statusTone[project.status]} data-testid="translation-status">{t.status[project.status]}</Badge>
        <IconButton size="sm" label={t.projectSettings} icon={<Settings2 />} onClick={() => setSettingsOpen(true)} />
        <DropdownMenu
          label={t.projectActions}
          align="end"
          trigger={<IconButton size="sm" label={t.projectActions} icon={<MoreHorizontal />} />}
          items={[{ label: t.deleteProject, icon: <Trash2 />, danger: true, onSelect: () => setConfirmDelete(true) }]}
        />
      </header>

      <SegmentedControl<TranslationTab>
        className="translation-tabs"
        size="sm"
        aria-label={t.workspaceTabs}
        value={tab}
        onChange={controller.setTab}
        options={[
          { value: "progress", label: t.tabProgress },
          { value: "pilot", label: t.tabPilot },
          { value: "glossary", label: t.tabGlossary },
          { value: "review", label: t.tabReview }
        ]}
      />

      <div className="translation-main__body" key={`${project.id}-${tab}`}>
        {tab === "progress" ? <ProgressTab controller={controller} project={project} /> : null}
        {tab === "pilot" ? <PilotTab controller={controller} project={project} /> : null}
        {tab === "glossary" ? <GlossaryTab controller={controller} project={project} /> : null}
        {tab === "review" ? <ReviewTab controller={controller} project={project} /> : null}
      </div>

      <ProjectSettingsModal
        open={settingsOpen}
        project={project}
        saving={controller.isBusy(`${project.id}:settings`)}
        onClose={() => setSettingsOpen(false)}
        onSave={async (patch) => controller.updateSettings(project.id, patch)}
      />
      <ConfirmationModal
        open={confirmDelete}
        tone="danger"
        title={t.deleteConfirmTitle}
        description={t.deleteConfirmDescription}
        confirmLabel={t.deleteConfirm}
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => {
          setConfirmDelete(false);
          void controller.deleteProject(project.id);
        }}
      />
    </section>
  );
}

/** Tradução: ChatGPT account + usage strip, books in translation, and the selected project's tabs. */
export function TranslationView({ controller, onBrowse }: TranslationViewProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { account } = controller;

  if (account.status === "unavailable") {
    return (
      <div className="translation-view translation-view--center">
        <EmptyState icon={<Monitor />} title={t.unavailableTitle} description={t.unavailableDescription} />
      </div>
    );
  }

  if (account.status === "error") {
    return (
      <div className="translation-view translation-view--center">
        <EmptyState
          tone="danger"
          icon={<CloudOff />}
          title={t.accountError}
          action={<Button icon={<RefreshCcw />} onClick={() => void controller.refreshAccount()}>{t.checkAgain}</Button>}
        >
          <code className="translation-install is-selectable">{account.message}</code>
        </EmptyState>
      </div>
    );
  }

  const hasProjects = controller.projects.length > 0;

  return (
    <div className="translation-view" data-testid="translation-page">
      <AccountStrip
        account={account}
        connecting={controller.connecting}
        loggingOut={controller.isBusy("logout")}
        usage={controller.usage}
        onConnect={() => void controller.connect()}
        onCancelConnect={controller.cancelConnect}
        onLogout={() => void controller.logout()}
        onManageUsage={controller.openUsagePage}
      />
      {controller.usage?.limitReached && !(controller.tab === "progress" && controller.selected?.status === "waiting_limit") ? (
        <LimitBanner limit={controller.usage.limitReached} />
      ) : null}

      {account.status === "loading" ? null : hasProjects ? (
        <div className="translation-layout">
          <ProjectList
            projects={controller.projects}
            library={controller.library}
            selectedId={controller.selectedId}
            onSelect={controller.selectProject}
            onTranslateBook={() => setPickerOpen(true)}
          />
          <Workspace controller={controller} />
        </div>
      ) : controller.projectsLoaded ? (
        <div className="translation-view__empty">
          <EmptyState
            icon={<Languages />}
            title={t.emptyProjectsTitle}
            description={t.emptyProjectsDescription}
            action={<Button variant="primary" icon={<Plus />} onClick={() => setPickerOpen(true)}>{t.translateBook}</Button>}
          />
        </div>
      ) : null}

      <BookPickerModal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        library={controller.library}
        books={controller.translatable}
        projects={controller.projects}
        creating={controller.isBusy("create")}
        onCreate={controller.createProject}
        onBrowse={() => {
          setPickerOpen(false);
          onBrowse();
        }}
      />
    </div>
  );
}
