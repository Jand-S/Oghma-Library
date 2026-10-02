import { AlertTriangle, CheckCircle2, RefreshCcw, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import type { ChapterView, ProjectDetail } from "../../services/translationClient";
import { translationStrings as t } from "../../strings/translation";
import { Badge, Button, SelectField, Skeleton, cx } from "../../ui";
import { getErrorMessage } from "../../services/backendClient";
import { Reader } from "./Reader";
import type { TranslationController } from "./useTranslationController";

/** "tooShort: 62%" → { label: "Texto curto", detail: "62%" }. */
export function describeIssue(issue: string) {
  const [code, ...rest] = issue.split(":");
  const label = t.issue[code.trim()] ?? code.trim();
  return { label, detail: rest.join(":").trim() };
}

function IssueBadges({ issues }: { issues: string[] }) {
  return (
    <span className="translation-issues">
      {issues.map((issue) => {
        const { label, detail } = describeIssue(issue);
        return (
          <Badge key={issue} tone="warning" title={detail || undefined} data-testid="review-issue">
            {label}
          </Badge>
        );
      })}
    </span>
  );
}

/** Revisar: verify report per chapter and the original × translation reader. */
export function ReviewTab({ controller, project }: { controller: TranslationController; project: ProjectDetail }) {
  const report = controller.report;
  const verifying = controller.isBusy(`${project.id}:verify`);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [chapter, setChapter] = useState<ChapterView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { verify, loadChapter } = controller;

  // Run the (free) verification the first time the tab opens for a project.
  useEffect(() => {
    if (!report) void verify(project.id);
  }, [project.id, report, verify]);

  const chapters = useMemo(() => report?.chapters ?? [], [report]);
  const withIssues = chapters.filter((item) => item.issues.length > 0);

  // Pick the first chapter with problems (else the first one) when the report arrives.
  useEffect(() => {
    if (chapters.length === 0) {
      setChapterIndex(null);
      return;
    }
    setChapterIndex((current) => (current != null && chapters.some((item) => item.index === current)
      ? current
      : (chapters.find((item) => item.issues.length > 0) ?? chapters[0]).index));
  }, [chapters]);

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

  // Proportional scroll sync between the two columns.
  const left = useRef<HTMLElement>(null);
  const right = useRef<HTMLElement>(null);
  const syncing = useRef<HTMLElement | null>(null);
  const sync = (event: UIEvent<HTMLElement>) => {
    const from = event.currentTarget;
    if (syncing.current && syncing.current !== from) {
      syncing.current = null;
      return;
    }
    const to = from === left.current ? right.current : left.current;
    if (!to) return;
    const ratio = from.scrollTop / Math.max(1, from.scrollHeight - from.clientHeight);
    syncing.current = to;
    to.scrollTop = ratio * Math.max(0, to.scrollHeight - to.clientHeight);
  };

  const current = chapters.find((item) => item.index === chapterIndex) ?? null;
  const retranslating = controller.isBusy(`${project.id}:retranslate`);
  const chapterOptions = chapters.map((item) => ({
    value: String(item.index),
    label: item.issues.length ? `${item.title} — ${t.issueCount(item.issues.length)}` : item.title
  }));

  return (
    <div className="translation-review" data-testid="translation-review">
      <section className="translation-block" aria-labelledby="translation-review-title">
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
          <Button size="sm" variant="ghost" icon={<RefreshCcw />} loading={verifying} title={t.reviewDescription} onClick={() => void verify(project.id)}>
            {t.verify}
          </Button>
        </header>

        {withIssues.length > 0 ? (
          <ul className="translation-review__issues" aria-label={t.reviewIssues(withIssues.length)}>
            {withIssues.map((item) => (
              <li key={item.index}>
                <button
                  type="button"
                  className="translation-review__issue"
                  aria-pressed={item.index === chapterIndex}
                  data-testid="review-chapter"
                  onClick={() => setChapterIndex(item.index)}
                >
                  <span className="translation-review__chapter truncate">{item.title}</span>
                  <IssueBadges issues={item.issues} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {report && chapters.length === 0 ? <p className="translation-block__meta">{t.noChapters}</p> : null}

      {current ? (
        <section className="translation-block translation-block--reader" aria-label={current.title}>
          <header className="translation-review__head">
            <SelectField
              label={t.chapterList}
              hideLabel
              fieldClassName="o-field--sm translation-review__picker"
              options={chapterOptions}
              value={String(current.index)}
              onChange={(event) => setChapterIndex(Number(event.target.value))}
            />
            {chapter ? <Badge tone={chapter.status === "needs_review" ? "warning" : chapter.status === "error" ? "danger" : "neutral"}>{t.chapterStatus[chapter.status] ?? chapter.status}</Badge> : null}
            <Button
              size="sm"
              icon={<RotateCcw />}
              loading={retranslating}
              disabled={!controller.loggedIn}
              title={controller.loggedIn ? undefined : t.needsLogin}
              onClick={() => void controller.retranslate(project.id, current.index, current.title).then((ok) => ok && setReloadKey((key) => key + 1))}
            >
              {t.retranslate}
            </Button>
          </header>
          {loadError ? (
            <p className="translation-inline-status translation-inline-status--danger" role="alert">{loadError}</p>
          ) : (
            <div className="translation-compare" data-testid="review-reader">
              <div className="translation-compare__col">
                <span className="translation-compare__label">{t.readerSource}</span>
                <Reader ref={left} html={chapter?.sourceHtml} label={t.readerSource} lang="en" onScroll={sync} testId="review-source" />
              </div>
              <div className="translation-compare__col">
                <span className="translation-compare__label">{t.readerTranslation}</span>
                <Reader
                  ref={right}
                  html={chapter?.translatedHtml}
                  label={t.readerTranslation}
                  lang="pt-BR"
                  onScroll={sync}
                  testId="review-translation"
                  empty={chapter ? t.notTranslated : undefined}
                />
              </div>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
