import { UserPlus, Users } from "lucide-react";
import { useEffect, useState } from "react";
import type { UserCard } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Button, ConfirmationModal, EmptyState, useToast } from "../../ui";
import { AddFriendSheet } from "./AddFriendSheet";
import { BookPicker } from "./BookPicker";
import { ChatThread } from "./ChatThread";
import { FriendProfile } from "./FriendProfile";
import { PeopleColumn, type PersonActions } from "./PeopleColumn";
import { RecommendationsPane } from "./RecommendationsPane";
import { SocialEnvContext, errorMessage, type SocialEnv, type SocialPlace } from "./socialEnv";
import "./social.css";

type Confirm = { kind: "unfriend" | "block"; user: UserCard } | null;

/**
 * Amigos, like Messages: people on the left, the open person on the right. The right side is a
 * conversation, that friend's shelf (from the conversation header or the right-click menu) or
 * the received recommendations. With nothing chosen it opens what needs attention.
 */
export function SocialView({ env: base, place: asked }: { env: Omit<SocialEnv, "place">; place: SocialPlace }) {
  const { social } = base;
  const { toast } = useToast();
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [bookFor, setBookFor] = useState<UserCard | null>(null);
  const nothingAsked = !asked.chat && !asked.friend && !asked.pane;
  const fallback = social.available && social.loaded && nothingAsked ? fallbackPlace(social) : null;

  // Nothing chosen: open what needs attention once and keep it (opening a conversation marks it
  // read, which must not flip the page to something else).
  useEffect(() => {
    if (fallback && (fallback.chat || fallback.pane)) base.go(fallback, { replace: true });
  }, [base, fallback?.chat, fallback?.pane]);

  if (!social.available) {
    return (
      <div className="social-page social-page--empty">
        <EmptyState icon={<Users />} title={t.title} description={t.networkError} />
      </div>
    );
  }

  const place = nothingAsked ? fallback ?? {} : asked;
  const env: SocialEnv = { ...base, place };

  const actions: PersonActions = {
    openChat: (friend) => env.go({ chat: friend.publicId }),
    openProfile: (friend) => env.go({ friend: friend.publicId }),
    recommendTo: (friend) => setBookFor(friend),
    unfriend: (user) => setConfirm({ kind: "unfriend", user }),
    block: (user) => setConfirm({ kind: "block", user })
  };

  const view = place.friend ? `p:${place.friend}` : place.chat ? `c:${place.chat}` : place.pane ?? "empty";

  return (
    <SocialEnvContext.Provider value={env}>
      <div className="social-page" data-testid="social-page">
        <PeopleColumn actions={actions} onAdd={() => setAdding(true)} />
        <section className="social-detail" aria-live="off">
          <div key={view} className="social-detail__view">
            {place.friend ? (
              <FriendProfile publicId={place.friend} actions={actions} />
            ) : place.chat ? (
              <ChatThread publicId={place.chat} />
            ) : place.pane === "recommendations" ? (
              <RecommendationsPane />
            ) : (
              <div className="social-welcome">
                <EmptyState
                  icon={<Users />}
                  title={t.emptyTitle}
                  description={t.emptyDescription}
                  action={<Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)}>{t.addFriend}</Button>}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      <AddFriendSheet social={social} open={adding} onClose={() => setAdding(false)} />

      <BookPicker
        mode={bookFor ? "library" : null}
        to={bookFor?.nickname}
        onClose={() => setBookFor(null)}
        onPick={(book) => {
          const friend = bookFor;
          if (!friend) return;
          void social.send(friend.publicId, { novelId: book.novelId, snapshot: book.snapshot }).then((result) => {
            if (!result.ok) toast({ message: errorMessage(result.error), tone: "danger" });
            else env.go({ chat: friend.publicId });
          });
        }}
      />

      <ConfirmationModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, user } = confirm;
          setConfirm(null);
          void (kind === "block" ? social.block(user.publicId) : social.remove(user.publicId)).then((result) => {
            if (!result.ok) toast({ message: errorMessage(result.error), tone: "danger" });
            else if (place.chat === user.publicId || place.friend === user.publicId) env.go({});
          });
        }}
        title={confirm ? (confirm.kind === "block" ? t.blockConfirm(confirm.user.nickname) : t.unfriendConfirm(confirm.user.nickname)) : ""}
        description={confirm?.kind === "block" ? t.blockDescription : t.unfriendDescription}
        confirmLabel={confirm?.kind === "block" ? t.block : t.unfriend}
        tone="danger"
      />
    </SocialEnvContext.Provider>
  );
}

/** Nothing chosen: new recommendations when no message waits, else the latest conversation. */
function fallbackPlace(social: SocialEnv["social"]): SocialPlace {
  if (social.newRecommendations && !social.unreadMessages) return { pane: "recommendations" };
  const latest = social.conversations[0]?.friend.publicId ?? social.friends.friends[0]?.publicId;
  if (latest) return { chat: latest };
  return social.recommendations.length ? { pane: "recommendations" } : {};
}
