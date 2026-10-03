import { Check, Clock, Download, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { statusLabel } from "../../constants/ui";
import { estimateChapters } from "../../core/defaults";
import type { ChapterPreset, ChapterSelection, DownloadFormat, Novel, NovelStatus } from "../../core/types";
import { offeredFormats } from "../../core/types";
import { discoverStrings } from "../../strings/discover";
import { Badge, Button, Chip, Cover, IconButton, SegmentedControl, Switch, TextField, cx, type BadgeTone } from "../../ui";

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

/** Detail tags beyond this many rows collapse behind a "+N" chip. */
const TAG_ROWS = 2;

/**
 * Right-hand details: a header row (source, preview badge, close), the hero (cover, title,
 * author, key badges), then the synopsis and the tags, plus the sticky download actions.
 */
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
  const synopsisRef = useRef<HTMLParagraphElement>(null);
  const [synopsisFits, setSynopsisFits] = useState(false);
  // With real layout, only offer "Mostrar mais" when the clamp actually cuts text.
  useLayoutEffect(() => {
    const node = synopsisRef.current;
    if (!node || synopsisOpen || node.clientHeight === 0) return;
    setSynopsisFits(node.scrollHeight <= node.clientHeight + 1);
  }, [synopsis, synopsisOpen]);
  const longSynopsis = synopsis.length > SYNOPSIS_CLAMP_CHARS && !synopsisFits;
  const backdrop = novel.coverUrl ? ({ backgroundImage: `url("${novel.coverUrl}")` } as CSSProperties) : undefined;

  return (
    <aside className="discover-detail" data-testid="discover-sidebar" aria-label={discoverStrings.detailsLabel}>
      <div className="discover-detail__scroll" key={novel.id} data-testid="discover-detail-panel">
        <div className="discover-detail__hero">
          <div className="discover-detail__backdrop" style={backdrop} aria-hidden="true" />
          <div className="discover-detail__topbar">
            <div className="discover-detail__context">
              <Badge tone="accent">{novel.sourceName}</Badge>
              {preview ? <Badge tone="warning">{discoverStrings.previewBadge}</Badge> : null}
            </div>
            <IconButton
              className="discover-detail__close"
              label={discoverStrings.closeDetails}
              icon={<X />}
              size="sm"
              variant="glass"
              onClick={onClose}
            />
          </div>
          <div className="discover-detail__cover" data-testid="detail-cover">
            <Cover src={novel.coverUrl} title={novel.title} size="lg" sheen />
          </div>
          <h2 className="discover-detail__title is-selectable">{novel.title}</h2>
          {novel.author ? <p className="discover-detail__author">{novel.author}</p> : null}
          <div className="discover-detail__badges">
            <Badge tone={statusTone[novel.status]}>{statusLabel[novel.status]}</Badge>
            {novel.sourceChapters ? (
              <Badge tone="warning" title={discoverStrings.chaptersIncompleteHint(novel.sourceChapters - novel.chapters)} data-testid="chapters-incomplete">
                {discoverStrings.chaptersCountOf(novel.chapters, novel.sourceChapters)}
              </Badge>
            ) : (
              <Badge>{discoverStrings.chaptersCount(novel.chapters)}</Badge>
            )}
            {novel.language ? <Badge>{novel.language.toUpperCase()}</Badge> : null}
            {novel.rating ? (
              <Badge aria-label={discoverStrings.ratingLabel(novel.rating, novel.ratingVotes)} data-testid="novel-rating">
                {discoverStrings.rating(novel.rating, novel.ratingVotes)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="discover-detail__body">
          <section className="discover-detail__section">
            <h3 className="discover-detail__section-title">{discoverStrings.synopsis}</h3>
            <p
              ref={synopsisRef}
              className={cx("discover-detail__synopsis is-selectable", !synopsisOpen && longSynopsis && "is-clamped")}
            >
              {synopsis || discoverStrings.noSynopsis}
            </p>
            {longSynopsis ? (
              <Button variant="ghost" size="sm" className="discover-detail__more" aria-expanded={synopsisOpen} onClick={() => setSynopsisOpen((value) => !value)}>
                {synopsisOpen ? discoverStrings.showLessSynopsis : discoverStrings.showMoreSynopsis}
              </Button>
            ) : null}
          </section>
          {novel.tags.length > 0 ? (
            <section className="discover-detail__section">
              <h3 className="discover-detail__section-title">{discoverStrings.tags}</h3>
              <DetailTags tags={novel.tags} />
            </section>
          ) : null}
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

/**
 * Tags limited to TAG_ROWS rows; the rest hide behind a "+N" chip that expands the list.
 * Rows are measured after layout (and on resize), so the "+N" chip always fits on the last row.
 */
function DetailTags({ tags }: { tags: string[] }) {
  const listRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  /** How many tags fit in TAG_ROWS rows next to the "+N" chip; null = not measured (render all). */
  const [fit, setFit] = useState<number | null>(null);

  const measure = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    const chips = Array.from(list.querySelectorAll<HTMLElement>("[data-tag-chip]"));
    const more = list.querySelector<HTMLElement>("[data-tag-more]");
    if (chips.length === 0 || chips[0].offsetHeight === 0) return; // no layout (tests)
    const rowTops = Array.from(new Set(chips.map((chip) => chip.offsetTop))).sort((a, b) => a - b);
    const limitTop = rowTops[TAG_ROWS - 1] ?? rowTops[rowTops.length - 1];
    let count = chips.filter((chip) => chip.offsetTop <= limitTop).length;
    if (count >= chips.length) {
      setFit(chips.length);
      return;
    }
    // Leave room for the "+N" chip at the end of the last visible row.
    const gap = Number.parseFloat(getComputedStyle(list).columnGap) || 0;
    const moreWidth = (more?.offsetWidth ?? 0) + gap;
    while (count > 0) {
      const last = chips[count - 1];
      if (last.offsetTop < limitTop || last.offsetLeft + last.offsetWidth + moreWidth <= list.clientWidth) break;
      count -= 1;
    }
    setFit(count);
  }, []);

  /** Bumped to force another measuring pass (width change, or the list had no layout yet). */
  const [pass, setPass] = useState(0);
  const fitRef = useRef(fit);
  fitRef.current = fit;

  // Measure with every chip rendered; re-measure when the tags or the width change.
  useLayoutEffect(() => setFit(null), [tags]);
  useLayoutEffect(() => {
    if (fit === null) measure();
  }, [fit, measure, pass]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    let width = -1;
    const observer = new ResizeObserver(() => {
      if (list.clientWidth === width && fitRef.current !== null) return;
      width = list.clientWidth;
      setFit(null);
      setPass((value) => value + 1);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  const measuring = fit === null;
  const hidden = measuring || expanded ? 0 : tags.length - fit;
  const shown = hidden > 0 ? tags.slice(0, fit ?? tags.length) : tags;

  return (
    <div className={cx("discover-detail__tags", measuring && "is-measuring")} ref={listRef}>
      {shown.map((tag) => (
        <span key={tag} className="discover-detail__tag" data-tag-chip="">
          <Chip>{tag}</Chip>
        </span>
      ))}
      {measuring ? (
        // Probe with the widest likely label, so the real chip always fits where it is placed.
        <span className="discover-detail__tag-more" data-tag-more="" aria-hidden="true">{discoverStrings.moreTags(tags.length)}</span>
      ) : hidden > 0 ? (
        <button
          type="button"
          className="discover-detail__tag-more"
          aria-label={discoverStrings.moreTagsLabel(hidden)}
          aria-expanded={false}
          onClick={() => setExpanded(true)}
        >
          {discoverStrings.moreTags(hidden)}
        </button>
      ) : expanded && fit !== null && fit < tags.length ? (
        <button
          type="button"
          className="discover-detail__tag-more"
          aria-label={discoverStrings.lessTagsLabel}
          aria-expanded
          onClick={() => setExpanded(false)}
        >
          {discoverStrings.lessTags}
        </button>
      ) : null}
    </div>
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
        : offeredFormats.filter((item) => selection.formats.includes(item) || item === format)
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
            {offeredFormats.map((format) => (
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
    </section>
  );
}
