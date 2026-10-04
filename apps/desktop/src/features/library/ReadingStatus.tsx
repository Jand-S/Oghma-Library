import { Ban, BookOpen, CheckCircle2, Circle, PauseCircle } from "lucide-react";
import type { LibraryReadingStatus } from "../../core/types";
import { libraryStrings } from "../../strings/library";
import { Chip, cx } from "../../ui";
import "./ReadingStatus.css";

export const readingStatuses: LibraryReadingStatus[] = ["unread", "reading", "paused", "completed", "dropped"];

export function ReadingStatusIcon({ status }: { status: LibraryReadingStatus }) {
  if (status === "reading") return <BookOpen />;
  if (status === "paused") return <PauseCircle />;
  if (status === "completed") return <CheckCircle2 />;
  if (status === "dropped") return <Ban />;
  return <Circle />;
}

/** Colored dot + label ("Lendo"); nothing for books not started. */
export function ReadingStatusLabel({ status, className }: { status?: LibraryReadingStatus; className?: string }) {
  if (!status || status === "unread") return null;
  return (
    <span className={cx("reading-status", `reading-status--${status}`, className)} data-testid="reading-status">
      <span className="reading-status__dot" aria-hidden="true" />
      {libraryStrings.readingStatusLabels[status]}
    </span>
  );
}

/** Single-choice chips for the details panel. */
export function ReadingStatusPicker({ value, onChange }: { value: LibraryReadingStatus; onChange: (status: LibraryReadingStatus) => void }) {
  return (
    <div className="reading-status-picker" role="radiogroup" aria-label={libraryStrings.readingStatus}>
      {readingStatuses.map((status) => (
        <span key={status} role="radio" aria-checked={value === status} className="reading-status-picker__option">
          <Chip
            selected={value === status}
            onToggle={() => onChange(status)}
            icon={<ReadingStatusIcon status={status} />}
            tone={value === status ? "accent" : "neutral"}
          >
            {libraryStrings.readingStatusLabels[status]}
          </Chip>
        </span>
      ))}
    </div>
  );
}
