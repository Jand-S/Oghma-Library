import { BookOpen, CloudDownload, MoreVertical, Send, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { BookSeries, LibraryItem } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { librarySeriesStrings as strings } from "../../strings/librarySeries";
import { Badge, Button, Cover, DropdownMenu, IconButton, ListGroup, cx } from "../../ui";
import { JobBadge } from "./libraryBadges";
import { formatSummary, isShelf, type BookJobState } from "./libraryModel";
import { ReadingStatusLabel } from "./ReadingStatus";
import { seriesAuthor } from "./seriesModel";
import type { BookActions } from "./useBookActions";
import "./series.css";

type SeriesDetailsProps = {
  series: BookSeries;
  /** The volumes in reading order (`volumesOf`). */
  volumes: LibraryItem[];
  actions: BookActions;
  jobState: (item: LibraryItem) => BookJobState | null;
  onOpen: (item: LibraryItem) => void;
  /** The existing "Enviar ao Kindle" flow with these books, in this order. */
  onSendToKindle: (items: LibraryItem[]) => void;
};

/** Covers fanned out like a pile of books: the first volume in front, up to two behind it. */
function CoverFan({ volumes }: { volumes: LibraryItem[] }) {
  const shown = volumes.slice(0, 3);
  return (
    <div className="library-series__fan" data-count={shown.length} data-testid="series-covers" aria-hidden="true">
      {shown.map((item, index) => (
        <div key={item.id} className="library-series__fan-cover" style={{ "--fan-index": index } as CSSProperties}>
          <Cover src={item.coverUrl} title={item.title} size="fill" sheen={index === 0} />
        </div>
      )).reverse()}
    </div>
  );
}

/** Series page: the pile of covers, "Enviar série ao Kindle" and the volumes in order, each with its actions. */
export function SeriesDetails({ series, volumes, actions, jobState, onOpen, onSendToKindle }: SeriesDetailsProps) {
  const downloaded = volumes.filter((item) => !isShelf(item));
  const author = seriesAuthor(volumes);
  const face = volumes[0];
  const backdrop = face?.coverUrl ? ({ "--library-hero-image": `url("${face.coverUrl}")` } as CSSProperties) : undefined;

  return (
    <article className="library-details library-series" data-testid="series-detail" aria-label={strings.detailLabel}>
      <header className={cx("library-hero", face?.coverUrl && "library-hero--image")} style={backdrop}>
        <div className="library-hero__backdrop" aria-hidden="true" />
        <div className="library-hero__inner">
          <div className="library-hero__content">
            <CoverFan volumes={volumes} />
            <div className="library-hero__info">
              <span className="library-hero__eyebrow">{strings.eyebrow}</span>
              <h2 className="library-hero__title is-selectable">{series.name}</h2>
              <p className="library-hero__author">{author || libraryStrings.unknownAuthor}</p>
              <div className="library-hero__badges">
                <Badge tone="accent">{strings.volumesCount(volumes.length)}</Badge>
              </div>
              <div className="library-actions" role="toolbar" aria-label={strings.seriesActions(series.name)}>
                <Button
                  variant="primary"
                  icon={<Send />}
                  data-testid="series-send-kindle"
                  disabled={downloaded.length === 0}
                  title={downloaded.length ? strings.sendSeriesHint(downloaded.length) : strings.noneDownloaded}
                  onClick={() => onSendToKindle(downloaded)}
                >
                  {strings.sendSeries}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="library-series__body">
        <ListGroup title={strings.volumesHeading} footer={strings.volumesFooter}>
          {volumes.map((item) => {
            const shelf = isShelf(item);
            const state = jobState(item);
            return (
              <div key={item.id} role="listitem" className={cx("library-volume", shelf && "is-shelf")} data-testid="series-volume">
                <button type="button" className="library-volume__open" onClick={() => onOpen(item)} aria-label={strings.openVolume(item.title)}>
                  <Cover src={item.coverUrl} title={item.title} size="sm" />
                  <span className="library-volume__text">
                    <span className="library-volume__number">{strings.volume(item.series?.volume ?? null)}</span>
                    <strong className="library-volume__title">{item.title}</strong>
                    <span className="library-volume__meta">
                      {state ? <JobBadge state={state} /> : null}
                      <ReadingStatusLabel status={item.readingStatus} />
                    </span>
                  </span>
                </button>
                <div className="library-volume__side">
                  {shelf ? <Badge><CloudDownload aria-hidden="true" />{libraryStrings.onShelfBadge}</Badge> : <Badge>{formatSummary(item)}</Badge>}
                  <div className="library-volume__actions">
                    <Button size="sm" variant="outline" icon={<BookOpen />} onClick={() => onOpen(item)}>{strings.open}</Button>
                    <IconButton
                      label={strings.sendVolume(item.title)}
                      icon={<Send />}
                      size="sm"
                      disabled={shelf}
                      onClick={() => onSendToKindle([item])}
                    />
                    <IconButton label={strings.removeVolume(item.title)} icon={<Trash2 />} size="sm" onClick={() => actions.askRemove(item)} />
                    <DropdownMenu
                      label={strings.volumeActions(item.title)}
                      align="end"
                      items={actions.menuItems(item)}
                      trigger={<IconButton label={strings.volumeActions(item.title)} icon={<MoreVertical />} size="sm" />}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </ListGroup>
      </div>
    </article>
  );
}
