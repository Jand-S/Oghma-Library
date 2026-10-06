import { Gift, X } from "lucide-react";
import { useState } from "react";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Badge, Button, EmptyState, SegmentedControl } from "../../ui";
import { BookCard } from "./BookCard";
import { shortWhen, useSocialEnv } from "./socialEnv";

/** Books friends sent: who, their note, the book, and Adicionar / Dispensar. */
export function RecommendationsPane() {
  const { social } = useSocialEnv();
  const [filter, setFilter] = useState<"new" | "all">(social.newRecommendations ? "new" : "all");
  const shown = social.recommendations.filter((rec) => filter === "all" || rec.noteStatus === "new");
  return (
    <div className="social-recs" data-testid="social-recommendations">
      <SegmentedControl<"new" | "all">
        aria-label={t.recsFilterLabel}
        size="sm"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "new", label: social.newRecommendations ? `${t.recsNew} · ${social.newRecommendations}` : t.recsNew },
          { value: "all", label: t.recsAll }
        ]}
        className="social-recs__filter"
      />
      {shown.length === 0 ? (
        <EmptyState icon={<Gift />} title={t.recsEmptyTitle} description={t.recsEmptyDescription} />
      ) : (
        <ul className="social-recs__list">
          {shown.map((rec) => (
            <li key={rec.id} className="social-rec" data-testid="social-recommendation">
              <div className="social-rec__who">
                <Avatar avatarId={rec.fromUser.avatarId} color={rec.fromUser.avatarColor} nickname={rec.fromUser.nickname} size="sm" />
                <span>{t.recommendedBy(rec.fromUser.nickname)}</span>
                <time dateTime={rec.createdAt}>{shortWhen(rec.createdAt)}</time>
                {rec.noteStatus === "added" ? <Badge tone="accent">{t.added}</Badge> : null}
                {rec.noteStatus === "dismissed" ? <Badge>{t.dismissed}</Badge> : null}
              </div>
              {rec.body ? <blockquote className="social-rec__note">{rec.body}</blockquote> : null}
              {rec.novelId ? (
                <BookCard
                  novelId={rec.novelId}
                  snapshot={rec.snapshot}
                  onAdded={() => void social.setNoteStatus(rec.id, "added")}
                >
                  {rec.noteStatus === "new" ? (
                    <Button variant="ghost" size="sm" icon={<X />} onClick={() => void social.setNoteStatus(rec.id, "dismissed")}>{t.dismiss}</Button>
                  ) : null}
                </BookCard>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
