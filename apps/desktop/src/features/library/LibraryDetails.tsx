import { AlertTriangle, CloudDownload, Download, Eye, EyeOff, FileCog, FolderOpen, Heart, MoreVertical, Plus, Search, Trash2 } from "lucide-react";
import { getPlatform } from "../../shell/platform";
import { useState, type CSSProperties } from "react";
import type { LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { AppleLogo, Badge, Banner, Button, Chip, Cover, DropdownMenu, IconButton, ListGroup, ListRow, PathControl, ProgressBar, StarRating, TextField, cx, type MenuItem } from "../../ui";
import { formatDownloadedAt, formatsOf, isShelf, jobLabel, type BookJobState } from "./libraryModel";
import { ReadingStatusLabel, ReadingStatusPicker } from "./ReadingStatus";
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

function formatAddedAt(addedAt: number) {
  return new Date(addedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

/** Book page: blurred cover hero, action bar, synopsis, reading notes and an Apple-style info list. Hide and delete live in the ⋯ menu. */
export function LibraryDetails({ item, library, actions, jobState }: LibraryDetailsProps) {
  const [tagInput, setTagInput] = useState("");
  const formats = formatsOf(item);
  const { navigate } = useNavigation();
  const original = item.translatedFrom ? library.allLibrary.find((book) => book.novelId === item.translatedFrom) : undefined;
  const tags = item.personalTags ?? [];
  const running = library.conversion.converterRunning;
  const busy = Boolean(jobState);
  const redownloadReason = actions.redownloadDisabledReason(item);
  const shelf = isShelf(item);

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
    item.hidden
      ? { label: libraryStrings.showInLibrary, icon: <Eye />, onSelect: () => library.unhideLibraryItem(item), separatorBefore: true }
      : { label: libraryStrings.removeFromLibrary, icon: <EyeOff />, onSelect: () => actions.askRemove(item), separatorBefore: true },
    ...(shelf ? [] : [{ label: libraryStrings.deleteFilesMenu, icon: <Trash2 />, onSelect: () => actions.askDelete(item), danger: true, separatorBefore: true }])
  ];
  const revealLabel = getPlatform() === "macos" ? libraryStrings.showInFinder : libraryStrings.openFolder;

  const backdrop = item.coverUrl ? ({ "--library-hero-image": `url("${item.coverUrl}")` } as CSSProperties) : undefined;

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
                {shelf && !item.unavailable ? (
                  <Badge><CloudDownload aria-hidden="true" />{libraryStrings.onShelfBadge}</Badge>
                ) : null}
                {item.favorite ? <Badge><Heart aria-hidden="true" />{libraryStrings.favorite}</Badge> : null}
              </div>
              {item.rating || (item.readingStatus && item.readingStatus !== "unread") ? (
                <div className="library-hero__reading">
                  <ReadingStatusLabel status={item.readingStatus} />
                  <StarRating size="sm" value={item.rating} compact />
                </div>
              ) : null}
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
                {shelf && item.unavailable ? (
                  <Button variant="primary" icon={<Search />} onClick={() => actions.findOtherEdition(item)} data-testid="library-find-edition">
                    {libraryStrings.findOtherEdition}
                  </Button>
                ) : shelf ? (
                  <Button
                    variant="primary"
                    icon={<CloudDownload />}
                    data-testid="library-download"
                    onClick={() => actions.download(item)}
                    disabled={Boolean(redownloadReason)}
                    title={redownloadReason ?? libraryStrings.downloadHint}
                  >
                    {libraryStrings.download}
                  </Button>
                ) : (
                  <Button variant="primary" icon={<FolderOpen />} onClick={() => library.openLibraryItemFolder(item)}>
                    {revealLabel}
                  </Button>
                )}
                {shelf ? null : <Button
                  variant={item.newChapters ? "primary" : "outline"}
                  icon={<Download />}
                  data-testid="library-redownload"
                  onClick={() => library.redownloadItem(item)}
                  disabled={Boolean(redownloadReason)}
                  title={redownloadReason ?? (item.newChapters ? libraryStrings.newChaptersHint(item.newChapters) : libraryStrings.redownloadHint)}
                >
                  {item.newChapters ? libraryStrings.updateWithNew(item.newChapters) : libraryStrings.downloadAgain}
                </Button>}
                {shelf ? null : (
                  <Button variant="outline" icon={<FileCog />} onClick={() => actions.openConvert(item)} disabled={running || busy}>
                    {libraryStrings.convert}
                  </Button>
                )}
                {library.icloudAvailable && !shelf ? (
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

      {shelf && item.unavailable ? (
        <div className="library-details__notice">
          <Banner tone="warning" icon={<AlertTriangle />} title={libraryStrings.unavailableBadge}>
            {libraryStrings.unavailableHint}
          </Banner>
        </div>
      ) : null}

      {item.hidden ? (
        <div className="library-details__notice">
          <Banner
            tone="info"
            icon={<EyeOff />}
            title={libraryStrings.hiddenBannerTitle}
            actions={(
              <Button variant="outline" size="sm" icon={<Eye />} onClick={() => library.unhideLibraryItem(item)} data-testid="library-unhide">
                {libraryStrings.showInLibrary}
              </Button>
            )}
          >
            {libraryStrings.showInLibraryHint}
          </Banner>
        </div>
      ) : null}

      <div className="library-details__body">
        <section className="library-details__main" aria-labelledby="library-synopsis-title">
          <h3 id="library-synopsis-title" className="library-details__heading">{libraryStrings.synopsis}</h3>
          <p className="library-details__synopsis is-selectable">{item.description?.trim() || libraryStrings.noSynopsis}</p>
        </section>

        <aside className="library-details__side">
          <section className="library-panel" aria-labelledby="library-reading-title">
            <h3 id="library-reading-title" className="library-panel__title">{libraryStrings.readingHeading}</h3>
            <div className="library-reading">
              <span className="library-details__label">{libraryStrings.readingStatus}</span>
              <ReadingStatusPicker value={item.readingStatus ?? "unread"} onChange={(status) => actions.setStatus(item, status)} />
            </div>
            <div className="library-reading library-reading--rating">
              <span className="library-details__label">{libraryStrings.ratingLabel}</span>
              <StarRating
                size="md"
                label={libraryStrings.ratingLabel}
                value={item.rating}
                onChange={(value) => actions.rate(item, value)}
              />
            </div>
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

          <ListGroup title={libraryStrings.infoHeading}>
            <ListRow label={libraryStrings.factSource}>{item.sourceName ?? libraryStrings.localSource}</ListRow>
            <ListRow label={libraryStrings.factAvailability}>{shelf ? libraryStrings.availabilityShelf : libraryStrings.availabilityLocal}</ListRow>
            {shelf ? null : <ListRow label={libraryStrings.factFormats}>{formats.join(", ")}</ListRow>}
            {item.chapters ? <ListRow label={libraryStrings.factChapters}>{item.chapters.toLocaleString("pt-BR")}</ListRow> : null}
            {shelf ? null : <ListRow label={libraryStrings.factSize}>{libraryStrings.size(item.sizeMb)}</ListRow>}
            {shelf ? null : <ListRow label={libraryStrings.factDownloaded}>{formatDownloadedAt(item)}</ListRow>}
            {item.addedAt ? <ListRow label={libraryStrings.factAdded}>{formatAddedAt(item.addedAt)}</ListRow> : null}
            {item.outputDir ? (
              <ListRow label={libraryStrings.factFolder} stacked>
                <PathControl
                  path={item.outputDir}
                  onReveal={() => library.openLibraryItemFolder(item)}
                  revealLabel={revealLabel}
                  copyLabel={libraryStrings.copyPath}
                  data-testid="library-path"
                />
              </ListRow>
            ) : null}
          </ListGroup>
        </aside>
      </div>
    </article>
  );
}
