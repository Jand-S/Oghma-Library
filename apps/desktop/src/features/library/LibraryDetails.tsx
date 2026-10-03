import { Download, Eye, EyeOff, FileCog, FolderOpen, Heart, MoreVertical, Plus, Trash2 } from "lucide-react";
import { useState, type CSSProperties } from "react";
import type { LibraryItem, LibraryReadingStatus } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { AppleLogo, Badge, Button, Chip, Cover, DropdownMenu, IconButton, ProgressBar, SelectField, TextField, cx, type MenuItem } from "../../ui";
import { formatDownloadedAt, formatsOf, jobLabel, type BookJobState } from "./libraryModel";
import type { BookActions } from "./useBookActions";
import type { LibraryController } from "./useLibraryController";
import { useNavigation } from "../../app/NavigationContext";
import { TranslationBadge } from "./LibraryCollection";

type LibraryDetailsProps = {
  item: LibraryItem;
  library: LibraryController;
  actions: BookActions;
  jobState: BookJobState | null;
};

const readingStatuses: LibraryReadingStatus[] = ["unread", "reading", "paused", "completed", "dropped"];

/** Hydra-style book page: blurred cover hero, action bar, reading notes and a danger zone. */
export function LibraryDetails({ item, library, actions, jobState }: LibraryDetailsProps) {
  const [tagInput, setTagInput] = useState("");
  const formats = formatsOf(item);
  const { navigate } = useNavigation();
  const original = item.translatedFrom ? library.allLibrary.find((book) => book.novelId === item.translatedFrom) : undefined;
  const tags = item.personalTags ?? [];
  const running = library.conversion.converterRunning;
  const busy = Boolean(jobState);
  const redownloadReason = actions.redownloadDisabledReason(item);

  const addTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    if (!tags.some((tag) => tag.toLowerCase() === value.toLowerCase())) {
      library.updateLibraryMeta(item, { tags: [...tags, value] });
    }
    setTagInput("");
  };

  const overflow: MenuItem[] = [
    {
      label: item.favorite ? libraryStrings.removeFavorite : libraryStrings.addFavorite,
      icon: <Heart />,
      onSelect: () => actions.toggleFavorite(item)
    },
    { label: libraryStrings.removeFromLibrary, icon: <EyeOff />, onSelect: () => actions.askRemove(item), separatorBefore: true },
    { label: libraryStrings.deleteFiles, icon: <Trash2 />, onSelect: () => actions.askDelete(item), danger: true }
  ];

  const backdrop = item.coverUrl ? ({ "--library-hero-image": `url("${item.coverUrl}")` } as CSSProperties) : undefined;
  const facts = [
    { label: libraryStrings.factSize, value: libraryStrings.size(item.sizeMb) },
    ...(item.chapters ? [{ label: libraryStrings.factChapters, value: item.chapters.toLocaleString("pt-BR") }] : []),
    { label: libraryStrings.factDownloaded, value: formatDownloadedAt(item) }
  ];

  return (
    <article className="library-details" data-testid="library-detail" aria-label={libraryStrings.detailsLabel}>
      <header className={cx("library-hero", item.coverUrl && "library-hero--image")} style={backdrop}>
        <div className="library-hero__backdrop" aria-hidden="true" />
        <div className="library-hero__inner">
          <div className="library-hero__content">
            <div className="library-hero__cover" data-testid="detail-cover">
              <Cover src={item.coverUrl} title={item.title} size="fill" sheen />
            </div>
            <div className="library-hero__info">
              <span className="library-hero__eyebrow">{item.sourceName ?? libraryStrings.localSource}</span>
              <h2 className="library-hero__title is-selectable">{item.title}</h2>
              <p className="library-hero__author">{item.author || libraryStrings.unknownAuthor}</p>
              <div className="library-hero__badges">
                <TranslationBadge item={item} />
                {formats.map((format) => <Badge key={format} tone="accent">{format}</Badge>)}
                {item.favorite ? <Badge><Heart aria-hidden="true" />{libraryStrings.favorite}</Badge> : null}
              </div>
              {item.translatedFrom ? (
                <p className="library-hero__origin" data-testid="library-translated-from">
                  {libraryStrings.translatedFrom}{" "}
                  <strong>{original?.title ?? item.translatedFrom}</strong>
                  {" · "}
                  <button type="button" className="library-hero__link" onClick={() => navigate("translation")}>
                    {libraryStrings.openTranslation}
                  </button>
                </p>
              ) : null}
              <dl className="library-hero__facts">
                {facts.map((fact) => (
                  <div key={fact.label} className="library-hero__fact">
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
              {jobState ? (
                <div className="library-hero__job" role="status">
                  <span>{jobLabel(jobState)}</span>
                  <ProgressBar
                    label={jobLabel(jobState)}
                    value={jobState.percent}
                    indeterminate={jobState.phase === "queued" || jobState.percent <= 0}
                    size="sm"
                  />
                </div>
              ) : null}
              <div className="library-actions" role="toolbar" aria-label={libraryStrings.moreActions}>
                <Button variant="primary" icon={<FolderOpen />} onClick={() => library.openLibraryItemFolder(item)}>
                  {libraryStrings.openFolder}
                </Button>
                <Button
                  variant={item.newChapters ? "primary" : "outline"}
                  icon={<Download />}
                  data-testid="library-redownload"
                  onClick={() => library.redownloadItem(item)}
                  disabled={Boolean(redownloadReason)}
                  title={redownloadReason ?? (item.newChapters ? libraryStrings.newChaptersHint(item.newChapters) : libraryStrings.redownloadHint)}
                >
                  {item.newChapters ? libraryStrings.updateWithNew(item.newChapters) : libraryStrings.downloadAgain}
                </Button>
                <Button variant="outline" icon={<FileCog />} onClick={() => actions.openConvert(item)} disabled={running || busy}>
                  {libraryStrings.convert}
                </Button>
                {library.icloudAvailable ? (
                  <Button
                    variant="outline"
                    icon={<AppleLogo />}
                    data-testid="library-icloud"
                    aria-label={libraryStrings.saveToICloud}
                    title={libraryStrings.saveToICloud}
                    loading={library.savingToICloud}
                    onClick={() => library.saveToICloud([item.id])}
                  >
                    {libraryStrings.icloudShort}
                  </Button>
                ) : null}
                <DropdownMenu
                  label={libraryStrings.moreActions}
                  align="start"
                  items={overflow}
                  trigger={<IconButton label={libraryStrings.moreActions} icon={<MoreVertical />} variant="outline" />}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="library-details__body">
        <section className="library-details__main" aria-labelledby="library-synopsis-title">
          <h3 id="library-synopsis-title" className="library-details__heading">{libraryStrings.synopsis}</h3>
          <p className="library-details__synopsis is-selectable">{item.description?.trim() || libraryStrings.noSynopsis}</p>
          {item.outputDir ? (
            <div className="library-details__folder">
              <span className="library-details__label">{libraryStrings.factFolder}</span>
              <code className="library-details__path is-selectable">{item.outputDir}</code>
            </div>
          ) : null}
        </section>

        <aside className="library-details__side">
          <section className="library-panel" aria-labelledby="library-reading-title">
            <h3 id="library-reading-title" className="library-details__heading">{libraryStrings.readingHeading}</h3>
            <SelectField
              label={libraryStrings.readingStatus}
              value={item.readingStatus ?? "unread"}
              options={readingStatuses.map((status) => ({ value: status, label: libraryStrings.readingStatusLabels[status] }))}
              onChange={(event) => library.updateLibraryMeta(item, { readingStatus: event.target.value as LibraryReadingStatus })}
            />
            <div className="library-tags">
              <span className="library-details__label">{libraryStrings.tagsLabel}</span>
              <div className="library-tags__list">
                {tags.length === 0 ? <span className="library-tags__empty">{libraryStrings.noTags}</span> : null}
                {tags.map((tag) => (
                  <Chip key={tag} onRemove={() => library.updateLibraryMeta(item, { tags: tags.filter((value) => value !== tag) })}>
                    {tag}
                  </Chip>
                ))}
              </div>
              <TextField
                label={libraryStrings.newTag}
                hideLabel
                placeholder={libraryStrings.newTag}
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addTag();
                  }
                }}
                trailing={<IconButton label={libraryStrings.addTag} icon={<Plus />} size="sm" onClick={addTag} disabled={!tagInput.trim()} />}
              />
            </div>
          </section>

          <section className="library-panel library-danger" aria-labelledby="library-danger-title">
            <h3 id="library-danger-title" className="library-details__heading library-danger__heading">{libraryStrings.dangerZone}</h3>
            <div className="library-danger__row">
              {item.hidden ? (
                <>
                  <div className="library-danger__text">
                    <strong>{libraryStrings.showInLibrary}</strong>
                    <span>{libraryStrings.showInLibraryHint}</span>
                  </div>
                  <Button variant="outline" size="sm" icon={<Eye />} onClick={() => library.unhideLibraryItem(item)} data-testid="library-unhide">
                    {libraryStrings.showInLibrary}
                  </Button>
                </>
              ) : (
                <>
                  <div className="library-danger__text">
                    <strong>{libraryStrings.removeFromLibrary}</strong>
                    <span>{libraryStrings.removeFromLibraryHint}</span>
                  </div>
                  <Button variant="outline" size="sm" icon={<EyeOff />} onClick={() => actions.askRemove(item)}>
                    {libraryStrings.removeFromLibrary}
                  </Button>
                </>
              )}
            </div>
            <div className="library-danger__row">
              <div className="library-danger__text">
                <strong>{libraryStrings.deleteFiles}</strong>
                <span>{libraryStrings.deleteFilesHint}</span>
              </div>
              <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => actions.askDelete(item)}>
                {libraryStrings.deleteFiles}
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </article>
  );
}
