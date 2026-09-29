import { FolderOpen, ListPlus, Play } from "lucide-react";
import { useState } from "react";
import type { LibraryItem } from "../../core/types";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, Cover, IconButton } from "../../ui";
import { formatsFor, projectStatus, type TranslationSessionItem } from "./translationModel";

type ProjectHeaderProps = {
  item: LibraryItem;
  batches: TranslationSessionItem[];
  onOpenFolder: () => void;
  onAddBatch: () => void;
  onStart: () => Promise<void>;
};

/** Selected project: identity, status and the page's actions (one primary: start). */
export function ProjectHeader({ item, batches, onOpenFolder, onAddBatch, onStart }: ProjectHeaderProps) {
  const [starting, setStarting] = useState(false);
  const status = projectStatus(batches);
  const pending = batches.filter((batch) => !batch.jobId).length;
  const meta = [
    item.author,
    item.chapters ? t.chapters(item.chapters) : t.localSize(item.sizeMb),
    formatsFor(item).join(", "),
    item.sourceName
  ].filter(Boolean).join(" · ");

  const start = () => {
    setStarting(true);
    void onStart().finally(() => setStarting(false));
  };

  return (
    <header className="translation-header">
      <Cover src={item.coverUrl} title={item.title} size="sm" sheen />
      <div className="translation-header__identity">
        <div className="translation-header__title-row">
          <h2 className="translation-header__title">{item.title}</h2>
          <Badge tone={status.tone}>{status.label}</Badge>
        </div>
        <p className="translation-header__meta">{meta}</p>
      </div>
      <div className="translation-header__actions">
        <IconButton label={t.openFolder} icon={<FolderOpen />} variant="ghost" onClick={onOpenFolder} />
        <Button icon={<ListPlus />} onClick={onAddBatch}>{t.addBatch}</Button>
        <Button
          variant="primary"
          icon={<Play />}
          loading={starting}
          disabled={pending === 0}
          title={pending === 0 ? t.startTranslationHint : undefined}
          onClick={start}
        >
          {t.startTranslation}
        </Button>
      </div>
    </header>
  );
}
