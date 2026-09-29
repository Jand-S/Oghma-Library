import { Check, Clock, Download, RotateCcw, X } from "lucide-react";
import { useEffect, useState, type CSSProperties } from "react";
import { statusLabel } from "../../constants/ui";
import { estimateChapters } from "../../core/defaults";
import type { ChapterPreset, ChapterSelection, DownloadFormat, Novel, NovelStatus } from "../../core/types";
import { downloadFormats } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, Chip, Cover, IconButton, SegmentedControl, Switch, TextField, type BadgeTone } from "../../ui";

/** Synopses longer than this start clamped with a "Mostrar mais" toggle. */
const SYNOPSIS_CLAMP_CHARS = 280;

const statusTone: Record<NovelStatus, BadgeTone> = {
  ongoing: "neutral",
  complete: "success",
  paused: "warning"
};

type DiscoverDetailPanelProps = {
  novel: Novel;
  /** True when `novel` is the selected book (the download configurator applies to it). */
  isSelected: boolean;
  preview: boolean;
  selection: ChapterSelection | null;
  adding: boolean;
  inLibrary: boolean;
  queued: boolean;
  onClose: () => void;
  onSelect: (novel: Novel) => void;
  onSelectionChange: (selection: ChapterSelection) => void;
  onAdd: () => void;
};

/** Right-hand details: hero (cover, backdrop, metadata, tags, synopsis) plus the sticky download actions. */
export function DiscoverDetailPanel({
  novel,
  isSelected,
  preview,
  selection,
  adding,
  inLibrary,
  queued,
  onClose,
  onSelect,
  onSelectionChange,
  onAdd
}: DiscoverDetailPanelProps) {
  const [synopsisOpen, setSynopsisOpen] = useState(false);
  useEffect(() => setSynopsisOpen(false), [novel.id]);

  const synopsis = novel.description.trim();
  const longSynopsis = synopsis.length > SYNOPSIS_CLAMP_CHARS;
  const backdrop = novel.coverUrl ? ({ backgroundImage: `url("${novel.coverUrl}")` } as CSSProperties) : undefined;

  return (
    <aside className="discover-detail" data-testid="discover-sidebar" aria-label={discoverStrings.detailsLabel}>
      <div className="discover-detail__scroll" key={novel.id} data-testid="discover-detail-panel">
        <div className="discover-detail__hero">
          <div className="discover-detail__backdrop" style={backdrop} aria-hidden="true" />
          <IconButton
            className="discover-detail__close"
            label={discoverStrings.closeDetails}
            icon={<X />}
            size="sm"
            variant="glass"
            onClick={onClose}
          />
          <div className="discover-detail__cover" data-testid="detail-cover">
            <Cover src={novel.coverUrl} title={novel.title} size="lg" sheen />
          </div>
          <h2 className="discover-detail__title is-selectable">{novel.title}</h2>
          {novel.author ? <p className="discover-detail__author">{novel.author}</p> : null}
          <div className="discover-detail__badges">
            {preview ? <Badge tone="warning">{discoverStrings.previewBadge}</Badge> : null}
            <Badge tone="accent">{novel.sourceName}</Badge>
            <Badge tone={statusTone[novel.status]}>{statusLabel[novel.status]}</Badge>
            <Badge>{discoverStrings.chaptersCount(novel.chapters)}</Badge>
            {novel.language ? <Badge>{novel.language.toUpperCase()}</Badge> : null}
          </div>
        </div>

        <div className="discover-detail__body">
          {novel.tags.length > 0 ? (
            <div className="discover-detail__tags">
              {novel.tags.map((tag) => <Chip key={tag}>{tag}</Chip>)}
            </div>
          ) : null}
          <section className="discover-detail__section">
            <h3 className="discover-detail__section-title">{discoverStrings.synopsis}</h3>
            <p className={synopsisOpen || !longSynopsis ? "discover-detail__synopsis is-selectable" : "discover-detail__synopsis is-selectable is-clamped"}>
              {synopsis || discoverStrings.noSynopsis}
            </p>
            {longSynopsis ? (
              <Button variant="ghost" size="sm" className="discover-detail__more" aria-expanded={synopsisOpen} onClick={() => setSynopsisOpen((value) => !value)}>
                {synopsisOpen ? discoverStrings.showLessSynopsis : discoverStrings.showMoreSynopsis}
              </Button>
            ) : null}
          </section>
          {novel.updatedAt ? <p className="discover-detail__updated">{discoverStrings.updated(novel.updatedAt)}</p> : null}
        </div>
      </div>

      <div className="discover-detail__actions">
        {isSelected && selection ? (
          <DownloadConfigurator
            novel={novel}
            selection={selection}
            adding={adding}
            inLibrary={inLibrary}
            queued={queued}
            onChange={onSelectionChange}
            onAdd={onAdd}
          />
        ) : (
          <div className="discover-config">
            <Button variant="primary" size="lg" block icon={<Check />} onClick={() => onSelect(novel)}>
              {discoverStrings.selectFromPreview}
            </Button>
            <p className="discover-config__note">{discoverStrings.previewHint}</p>
          </div>
        )}
      </div>
    </aside>
  );
}

function DownloadConfigurator({
  novel,
  selection,
  adding,
  inLibrary,
  queued,
  onChange,
  onAdd
}: {
  novel: Novel;
  selection: ChapterSelection;
  adding: boolean;
  inLibrary: boolean;
  queued: boolean;
  onChange: (selection: ChapterSelection) => void;
  onAdd: () => void;
}) {
  const update = (patch: Partial<ChapterSelection>) => onChange({ ...selection, ...patch });
  const toggleFormat = (format: DownloadFormat) => {
    const has = selection.formats.includes(format);
    if (has && selection.formats.length === 1) return; // at least one format
    update({
      formats: has
        ? selection.formats.filter((item) => item !== format)
        : downloadFormats.filter((item) => selection.formats.includes(item) || item === format)
    });
  };
  const setPreset = (preset: ChapterPreset) =>
    update(preset === "range" ? { preset, start: 1, end: novel.chapters } : { preset });
  const clampStart = (raw: number) => Math.max(1, Math.min(raw || 1, selection.end));
  const clampEnd = (raw: number) => Math.min(novel.chapters, Math.max(raw || selection.start, selection.start));

  const hint = queued ? discoverStrings.alreadyQueuedHint : inLibrary ? discoverStrings.replaceHint : null;
  const label = queued ? discoverStrings.queued : inLibrary ? discoverStrings.downloadAgain : discoverStrings.addToQueue;
  const icon = queued ? <Clock /> : inLibrary ? <RotateCcw /> : <Download />;

  return (
    <section className="discover-config" data-testid="queue-panel" aria-label={discoverStrings.queueHeading}>
      <div className="discover-config__card" data-testid="selection-card" data-card-id={novel.id}>
        <div className="discover-config__head">
          <strong className="discover-config__title" title={novel.title}>{novel.title}</strong>
          <span className="discover-config__summary">
            {discoverStrings.selectionSummary(estimateChapters(selection, novel.chapters))}
          </span>
        </div>
        <div className="discover-config__row">
          <span className="discover-config__label" id="discover-config-formats">{discoverStrings.formats}</span>
          <div className="discover-config__chips" role="group" aria-labelledby="discover-config-formats">
            {downloadFormats.map((format) => (
              <Chip key={format} selected={selection.formats.includes(format)} onToggle={() => toggleFormat(format)}>
                {format}
              </Chip>
            ))}
          </div>
        </div>
        <div className="discover-config__row">
          <span className="discover-config__label" aria-hidden="true">{discoverStrings.chapters}</span>
          <SegmentedControl<ChapterPreset>
            aria-label={discoverStrings.chapterPreset}
            size="sm"
            options={[
              { value: "all", label: discoverStrings.presetAll },
              { value: "range", label: discoverStrings.presetRange }
            ]}
            value={selection.preset}
            onChange={setPreset}
          />
        </div>
        {selection.preset === "range" ? (
          <div className="discover-config__range">
            <TextField
              label={discoverStrings.rangeStart}
              type="number"
              inputMode="numeric"
              min={1}
              max={selection.end}
              value={selection.start}
              onChange={(event) => update({ start: clampStart(Number(event.target.value)) })}
            />
            <TextField
              label={discoverStrings.rangeEnd}
              type="number"
              inputMode="numeric"
              min={selection.start}
              max={novel.chapters}
              value={selection.end}
              onChange={(event) => update({ end: clampEnd(Number(event.target.value)) })}
            />
          </div>
        ) : null}
        <Switch
          className="discover-config__switch"
          label={discoverStrings.audiobook}
          checked={selection.audiobook}
          onChange={(audiobook) => update({ audiobook })}
        />
      </div>
      {hint ? <p className="discover-config__hint" data-testid="selection-hint">{hint}</p> : null}
      <Button
        variant="primary"
        size="lg"
        block
        icon={icon}
        data-testid="add-to-queue"
        disabled={queued}
        loading={adding}
        onClick={onAdd}
      >
        {label}
      </Button>
      <p className="discover-config__note">{discoverStrings.oneAtATime}</p>
    </section>
  );
}
