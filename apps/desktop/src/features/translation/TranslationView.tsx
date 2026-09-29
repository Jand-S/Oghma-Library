import { BookOpenText, Info, Search } from "lucide-react";
import { useState } from "react";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, EmptyState, SegmentedControl } from "../../ui";
import { ConfigTab } from "./ConfigTab";
import { GlossaryTab } from "./GlossaryTab";
import { ProjectHeader } from "./ProjectHeader";
import { ProjectList } from "./ProjectList";
import { SessionTab } from "./SessionTab";
import type { TranslationTab } from "./translationModel";
import type { TranslationController } from "./useTranslationController";
import { useTranslationMemory } from "./useTranslationMemory";
import { useTranslationPlanner } from "./useTranslationPlanner";
import "./translation.css";

function PreviewBanner() {
  return (
    <div className="translation-banner" role="note" data-testid="translation-preview-banner">
      <Info className="translation-banner__icon" aria-hidden="true" />
      <div className="translation-banner__text">
        <strong>{t.previewBanner}</strong> {t.previewBannerDetail}
      </div>
      <Badge tone="warning">{t.beta}</Badge>
    </div>
  );
}

export function TranslationView({ controller, onBrowse }: { controller: TranslationController; onBrowse: () => void }) {
  const [tab, setTab] = useState<TranslationTab>("session");
  const plan = useTranslationPlanner(controller);
  const memory = useTranslationMemory(controller);
  const { library, selectedItem, projectItems } = controller;

  if (library.length === 0) {
    return (
      <div className="translation-view translation-view--empty">
        <PreviewBanner />
        <EmptyState
          icon={<BookOpenText />}
          title={t.emptyLibraryTitle}
          description={t.emptyLibraryDescription}
          action={<Button variant="primary" icon={<Search />} onClick={onBrowse}>{t.emptyLibraryAction}</Button>}
        />
      </div>
    );
  }

  const addBatch = () => {
    const draft = plan.buildDraft();
    if (draft) controller.addBatch(draft);
  };

  return (
    <div className="translation-view">
      <PreviewBanner />
      <div className="translation-layout">
        <ProjectList controller={controller} />
        <section className="translation-main" aria-label={selectedItem?.title}>
          {selectedItem ? (
            <>
              <ProjectHeader
                item={selectedItem}
                batches={projectItems}
                onOpenFolder={() => controller.openFolder(selectedItem)}
                onAddBatch={addBatch}
                onStart={() => controller.startTranslation(selectedItem.id)}
              />
              <SegmentedControl<TranslationTab>
                className="translation-tabs"
                aria-label={t.workspaceTabs}
                value={tab}
                onChange={setTab}
                options={[
                  { value: "session", label: t.tabSession },
                  { value: "glossary", label: t.tabGlossary },
                  { value: "config", label: t.tabConfig }
                ]}
              />
              <div className="translation-main__body" key={tab}>
                {tab === "session" ? <SessionTab controller={controller} plan={plan} onOpenConfig={() => setTab("config")} /> : null}
                {tab === "glossary" ? <GlossaryTab controller={controller} memory={memory} /> : null}
                {tab === "config" ? <ConfigTab controller={controller} plan={plan} memory={memory} /> : null}
              </div>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
