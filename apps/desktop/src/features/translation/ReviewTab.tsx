import { AlertTriangle, CheckCheck, CheckCircle2, ChevronLeft, ChevronRight, RefreshCcw, RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChapterView, ChunkView, ProjectDetail } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, IconButton, SelectField, Skeleton, cx } from "../../ui";
import { getErrorMessage } from "../../services/backendClient";
import { sanitizeHtml } from "./sanitizeHtml";
import type { TranslationController } from "./useTranslationController";

/** "tooShort: trecho 2 (62% das palavras)" → { code, label: "Texto curto", detail }. */
export function describeIssue(issue: string) {
  const [code, ...rest] = issue.split(":");
  const key = code.trim();
  return { code: key, label: t.issue[key] ?? key, detail: rest.join(":").trim() };
}

/** Chunk number (0-based) from a chapter issue like "englishLeft: trecho 3 (…)". */
function chunkOf(issue: string): number | null {
  const match = /trecho (\d+)/.exec(issue);
  return match ? Number(match[1]) - 1 : null;
}

function IssueBadges({ issues }: { issues: string[] }) {
  return (
    <span className="translation-issues">
      {[...new Set(issues.map((issue) => describeIssue(issue).code))].map((code) => (
        <Badge key={code} tone="warning" data-testid="review-issue">
          {t.issue[code] ?? code}
        </Badge>
      ))}
    </span>
  );
}

/** One translated paragraph; leftover English words are wrapped in <mark>. */
function TranslatedParagraph({ html, words }: { html: string; words: string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const clean = useMemo(() => sanitizeHtml(html), [html]);
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root || words.length === 0) return;
    const pattern = new RegExp(`\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    for (const node of nodes) {
      const text = node.data;
      pattern.lastIndex = 0;
      if (!pattern.test(text)) continue;
      pattern.lastIndex = 0;
      const fragment = document.createDocumentFragment();
      let last = 0;
      for (const match of text.matchAll(pattern)) {
        const at = match.index ?? 0;
        fragment.append(text.slice(last, at));
        const mark = document.createElement("mark");
        mark.className = "translation-review__en";
        mark.textContent = match[0];
        fragment.append(mark);
        last = at + match[0].length;
      }
      fragment.append(text.slice(last));
      node.replaceWith(fragment);
    }
  }, [clean, words]);
  return <div ref={ref} className="translation-review__text" lang="pt-BR" dangerouslySetInnerHTML={{ __html: clean }} />;
}

function ChunkBlock({
  chunk,
  total,
  busyRetranslate,
  busyReviewed,
  canTranslate,
  onRetranslate,
  onReviewed,
  anchorRef
}: {
  chunk: ChunkView;
  total: number;
  busyRetranslate: boolean;
  busyReviewed: boolean;
  canTranslate: boolean;
  onRetranslate: () => void;
  onReviewed: () => void;
  anchorRef: (el: HTMLElement | null) => void;
}) {
  const hasIssues = chunk.issues.length > 0;
  const codes = [...new Set(chunk.issues.map((issue) => describeIssue(issue).code))];
  return (
    <section
      ref={anchorRef}
      className={cx("translation-review__chunk", hasIssues && "translation-review__chunk--issue")}
      aria-label={t.chunkLabel(chunk.index + 1, total)}
      data-testid="review-chunk"
      data-chunk={chunk.index}
    >
      {hasIssues ? (
        <div className="translation-review__alert" role="note" data-testid="review-chunk-alert">
          <AlertTriangle aria-hidden="true" className="translation-review__alert-icon" />
          <div className="translation-review__alert-body">
            <p className="translation-review__alert-title">
              {t.chunkLabel(chunk.index + 1, total)} · <IssueBadges issues={chunk.issues} />
            </p>
            <ul className="translation-review__help">
              {codes.map((code) => (
                <li key={code}>{t.issueHelp[code] ?? t.issue[code] ?? code}</li>
              ))}
              {chunk.englishWords.length > 0 ? <li>{t.englishMarked}</li> : null}
            </ul>
          </div>
          <div className="translation-review__alert-actions">
            <Button size="sm" icon={<RotateCcw />} loading={busyRetranslate} disabled={!canTranslate} title={canTranslate ? undefined : t.needsLogin} onClick={onRetranslate}>
              {t.retranslateChunk}
            </Button>
            <Button size="sm" variant="ghost" icon={<CheckCheck />} loading={busyReviewed} onClick={onReviewed}>
              {t.markReviewed}
            </Button>
          </div>
        </div>
      ) : chunk.reviewed ? (
        <p className="translation-review__chunk-meta">
          {t.chunkLabel(chunk.index + 1, total)} · <Badge tone="success">{t.reviewedBadge}</Badge>
        </p>
      ) : null}
      <div className="translation-review__pairs">
        {chunk.pairs.map((pair, i) => (
          <div className="translation-review__pair" key={i}>
            <div
              className="translation-review__text translation-review__text--source"
              lang="en"
              dangerouslySetInnerHTML={{ __html: sanitizeHtml(pair.source) }}
            />
            {pair.translated ? (
              <TranslatedParagraph html={pair.translated} words={chunk.englishWords} />
            ) : (
              <div className="translation-review__text translation-review__text--missing">{t.paragraphMissing}</div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Revisar: chapters with problems on the left, the chapter as aligned paragraph pairs on the right. */
export function ReviewTab({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const report = controller.report;
  const verifying = controller.isBusy(`${project.id}:verify`);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [focusChunk, setFocusChunk] = useState<number | null>(null);
  const [chapter, setChapter] = useState<ChapterView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const anchors = useRef(new Map<number, HTMLElement>());
  const { verify, loadChapter } = controller;

  // Run the (free) verification the first time the tab opens for a project.
  useEffect(() => {
    if (!report) void verify(project.id);
  }, [project.id, report, verify]);

  const chapters = useMemo(() => report?.chapters ?? [], [report]);
  const withIssues = chapters.filter((item) => item.issues.length > 0);

  /** Every problem (chapter + chunk) in reading order, for "Anterior / Próximo problema". */
  const problems = useMemo(() => {
    const list: { chapter: number; chunk: number | null }[] = [];
    for (const item of withIssues) {
      const chunks = [...new Set(item.issues.map(chunkOf))].sort((a, b) => (a ?? -1) - (b ?? -1));
      for (const chunk of chunks) list.push({ chapter: item.index, chunk });
    }
    return list;
  }, [withIssues]);
  const problemAt = problems.findIndex((p) => p.chapter === chapterIndex && p.chunk === focusChunk);

  const goTo = (chapterIdx: number, chunk: number | null) => {
    setChapterIndex(chapterIdx);
    setFocusChunk(chunk);
    if (chapterIdx === chapterIndex) scrollToChunk(chunk);
  };
  const step = (delta: number) => {
    if (problems.length === 0) return;
    const from = problemAt === -1 ? (delta > 0 ? -1 : 0) : problemAt;
    const next = problems[(from + delta + problems.length) % problems.length];
    goTo(next.chapter, next.chunk);
  };

  // Start on the first problem (else the first chapter) when the report arrives.
  useEffect(() => {
    if (chapters.length === 0) {
      setChapterIndex(null);
      return;
    }
    setChapterIndex((current) => {
      if (current != null && chapters.some((item) => item.index === current)) return current;
      const first = problems[0];
      setFocusChunk(first?.chunk ?? null);
      return first?.chapter ?? chapters[0].index;
    });
  }, [chapters, problems]);

  useEffect(() => {
    if (chapterIndex == null) return;
    let alive = true;
    setLoadError(null);
    loadChapter(project.id, chapterIndex)
      .then((view) => alive && setChapter(view))
      .catch((error: unknown) => {
        if (!alive) return;
        setChapter(null);
        setLoadError(getErrorMessage(error, t.chapterLoadFailed));
      });
    return () => {
      alive = false;
    };
  }, [chapterIndex, loadChapter, project.id, reloadKey]);

  function scrollToChunk(chunk: number | null) {
    const el = chunk == null ? null : anchors.current.get(chunk);
    el?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }
  // After a chapter loads, bring the focused problem into view.
  useEffect(() => {
    if (chapter && chapter.index === chapterIndex) scrollToChunk(focusChunk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter]);

  const current = chapters.find((item) => item.index === chapterIndex) ?? null;
  const chapterOptions = chapters.map((item) => ({
    value: String(item.index),
    label: item.issues.length ? `${item.title} — ${t.issueCount(new Set(item.issues.map(chunkOf)).size)}` : item.title
  }));
  const shown = chapter && chapter.index === chapterIndex ? chapter : null;

  const markReviewed = async (chunk: number) => {
    if (chapterIndex == null) return;
    const view = await controller.markReviewed(project.id, chapterIndex, chunk);
    if (view) setChapter(view);
  };
  const retranslateChunk = async (chunk: number) => {
    if (chapterIndex == null) return;
    if (await controller.retranslateChunk(project.id, chapterIndex, chunk)) setReloadKey((key) => key + 1);
  };

  return (
    <div className="translation-review" data-testid="translation-review">
      <section className="translation-block translation-review__bar" aria-labelledby="translation-review-title">
        <header className="translation-block__header">
          <div className="translation-block__heading translation-block__heading--inline">
            <h3 className="translation-block__title" id="translation-review-title" title={t.reviewDescription}>{t.reviewHeading}</h3>
            {report ? (
              <span className={cx("translation-inline-status", withIssues.length ? "translation-inline-status--warn" : "translation-inline-status--ok")} data-testid="review-summary">
                {withIssues.length ? <AlertTriangle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                {withIssues.length ? t.reviewIssues(withIssues.length) : t.reviewOk}
              </span>
            ) : verifying ? (
              <Skeleton height={16} width="12rem" />
            ) : null}
          </div>
          <div className="translation-block__actions">
            {problems.length > 0 ? (
              <span className="translation-review__nav" data-testid="review-nav">
                <IconButton size="sm" label={t.prevProblem} icon={<ChevronLeft />} onClick={() => step(-1)} />
                <span className="translation-review__nav-count">{t.problemNav(problemAt === -1 ? 0 : problemAt + 1, problems.length)}</span>
                <IconButton size="sm" label={t.nextProblem} icon={<ChevronRight />} onClick={() => step(1)} />
              </span>
            ) : null}
            <Button size="sm" variant="ghost" icon={<RefreshCcw />} loading={verifying} title={t.reviewDescription} onClick={() => void verify(project.id)}>
              {t.verify}
            </Button>
          </div>
        </header>
      </section>

      {report && chapters.length === 0 ? <p className="translation-block__meta">{t.noChapters}</p> : null}

      {current ? (
        <div className={cx("translation-review__layout", withIssues.length === 0 && "translation-review__layout--single")}>
          {withIssues.length > 0 ? (
            <nav className="translation-review__side" aria-label={t.chaptersWithIssues}>
              <p className="translation-review__side-title">{t.chaptersWithIssues}</p>
              <ul className="translation-review__issues">
                {withIssues.map((item) => (
                  <li key={item.index}>
                    <button
                      type="button"
                      className="translation-review__issue"
                      aria-pressed={item.index === chapterIndex}
                      data-testid="review-chapter"
                      onClick={() => goTo(item.index, chunkOf(item.issues[0]))}
                    >
                      <span className="translation-review__chapter">{item.title}</span>
                      <IssueBadges issues={item.issues} />
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}

          <section className="translation-block translation-review__main" aria-label={current.title}>
            <header className="translation-review__head">
              <SelectField
                label={t.browseChapter}
                hideLabel
                fieldClassName="o-field--sm translation-review__picker"
                options={chapterOptions}
                value={String(current.index)}
                onChange={(event) => goTo(Number(event.target.value), null)}
              />
              {shown ? <Badge tone={shown.status === "needs_review" ? "warning" : shown.status === "error" ? "danger" : "neutral"}>{t.chapterStatus[shown.status] ?? shown.status}</Badge> : null}
              <Button
                size="sm"
                variant="ghost"
                icon={<RotateCcw />}
                loading={controller.isBusy(`${project.id}:retranslate`)}
                disabled={!controller.loggedIn}
                title={controller.loggedIn ? undefined : t.needsLogin}
                onClick={() => void controller.retranslate(project.id, current.index, current.title).then((ok) => ok && setReloadKey((key) => key + 1))}
              >
                {t.retranslate}
              </Button>
            </header>
            <div className="translation-review__columns" aria-hidden="true">
              <span>{t.readerSource}</span>
              <span>{t.readerTranslation}</span>
            </div>
            {loadError ? (
              <p className="translation-inline-status translation-inline-status--danger" role="alert">{loadError}</p>
            ) : !shown ? (
              <Skeleton height={240} />
            ) : (
              <div className="translation-review__chunks" data-testid="review-reader">
                {shown.chunks.map((chunk) => (
                  <ChunkBlock
                    key={chunk.index}
                    chunk={chunk}
                    total={shown.chunks.length}
                    canTranslate={controller.loggedIn}
                    busyRetranslate={controller.isBusy(`${project.id}:retranslate:${shown.index}:${chunk.index}`)}
                    busyReviewed={controller.isBusy(`${project.id}:reviewed:${shown.index}:${chunk.index}`)}
                    onRetranslate={() => void retranslateChunk(chunk.index)}
                    onReviewed={() => void markReviewed(chunk.index)}
                    anchorRef={(el) => {
                      if (el) anchors.current.set(chunk.index, el);
                      else anchors.current.delete(chunk.index);
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
