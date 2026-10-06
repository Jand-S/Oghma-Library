import { Ban, MessageCircle, MoreHorizontal, Search, UserMinus, UserPlus, UserRound, Users } from "lucide-react";
import { useState, type FormEvent } from "react";
import type { UserCard } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, ConfirmationModal, DropdownMenu, EmptyState, IconButton, TextField, useToast } from "../../ui";
import { longDate, useSocialEnv } from "./socialEnv";

export function errorMessage(error: string): string {
  if (error === "not_found") return t.notFound;
  if (error === "already_friends") return t.alreadyFriends;
  if (error === "rate_limited") return t.rateLimited;
  if (error === "network") return t.networkError;
  return t.genericError;
}

function Person({ user, detail, children }: { user: UserCard; detail?: string; children?: React.ReactNode }) {
  return (
    <div className="social-person" role="listitem">
      <Avatar avatarId={user.avatarId} color={user.avatarColor} nickname={user.nickname} size="md" />
      <div className="social-person__text">
        <strong>@{user.nickname}</strong>
        {detail ? <span>{detail}</span> : null}
      </div>
      <div className="social-person__actions">{children}</div>
    </div>
  );
}

type Confirm = { kind: "unfriend" | "block"; user: UserCard } | null;

/** Add by exact nickname, pending requests (both ways) and the friends list. */
export function FriendsPane() {
  const { social, go } = useSocialEnv();
  const { toast } = useToast();
  const [nickname, setNickname] = useState("");
  const [found, setFound] = useState<UserCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);

  const lookup = async (event: FormEvent) => {
    event.preventDefault();
    const name = nickname.trim().replace(/^@/, "");
    if (!name) return;
    setBusy(true);
    setError(null);
    setFound(null);
    const result = await social.lookup(name);
    setBusy(false);
    if (result.ok) setFound(result.value);
    else setError(errorMessage(result.error));
  };

  const sendRequest = async (user: UserCard) => {
    setBusy(true);
    const result = await social.requestFriend(user.nickname);
    setBusy(false);
    if (!result.ok) {
      setError(errorMessage(result.error));
      return;
    }
    toast({ message: result.value.status === "accepted" ? t.nowFriends(user.nickname) : t.requestSent(user.nickname), tone: "success" });
    setFound(null);
    setNickname("");
  };

  const run = async (action: () => Promise<{ ok: boolean; error?: string }>) => {
    const result = await action();
    if (!result.ok) toast({ message: errorMessage((result as { error: string }).error), tone: "danger" });
  };

  const { friends, incoming, outgoing } = social.friends;
  const isFriend = (user: UserCard) => friends.some((friend) => friend.publicId === user.publicId);
  const isPending = (user: UserCard) => outgoing.some((request) => request.publicId === user.publicId);

  return (
    <div className="social-friends" data-testid="social-friends">
      <section className="social-card" aria-labelledby="social-add-title">
        <h3 id="social-add-title" className="social-card__title"><UserPlus aria-hidden="true" />{t.addTitle}</h3>
        <p className="social-card__hint">{t.addHint}</p>
        <form className="social-add" onSubmit={lookup}>
          <TextField
            label={t.addLabel}
            hideLabel
            placeholder={t.addPlaceholder}
            value={nickname}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => {
              setNickname(event.target.value);
              setFound(null);
              setError(null);
            }}
            leading={<Search aria-hidden="true" />}
            fieldClassName="social-add__field"
            data-testid="social-add-input"
          />
          <Button type="submit" variant="outline" loading={busy && !found} disabled={!nickname.trim()}>{t.lookup}</Button>
        </form>
        {error ? <p className="social-add__error" role="alert">{error}</p> : null}
        {found ? (
          <div className="social-add__found" role="list">
            <Person user={found}>
              {isFriend(found) ? (
                <span className="social-person__note">{t.alreadyFriends}</span>
              ) : isPending(found) ? (
                <span className="social-person__note">{t.waiting}</span>
              ) : (
                <Button variant="primary" size="sm" icon={<UserPlus />} loading={busy} onClick={() => void sendRequest(found)} data-testid="social-send-request">
                  {t.sendRequest}
                </Button>
              )}
            </Person>
          </div>
        ) : null}
      </section>

      {incoming.length ? (
        <section className="social-section" aria-labelledby="social-incoming">
          <h3 id="social-incoming" className="social-section__title">{t.incoming}</h3>
          <div className="social-list" role="list">
            {incoming.map((request) => (
              <Person key={request.publicId} user={request}>
                <Button variant="primary" size="sm" onClick={() => void run(() => social.accept(request.publicId))}>{t.accept}</Button>
                <Button variant="ghost" size="sm" onClick={() => void run(() => social.remove(request.publicId))}>{t.decline}</Button>
              </Person>
            ))}
          </div>
        </section>
      ) : null}

      {outgoing.length ? (
        <section className="social-section" aria-labelledby="social-outgoing">
          <h3 id="social-outgoing" className="social-section__title">{t.outgoing}</h3>
          <div className="social-list" role="list">
            {outgoing.map((request) => (
              <Person key={request.publicId} user={request} detail={t.waiting}>
                <Button variant="ghost" size="sm" onClick={() => void run(() => social.remove(request.publicId))}>{t.cancelRequest}</Button>
              </Person>
            ))}
          </div>
        </section>
      ) : null}

      <section className="social-section" aria-labelledby="social-friends-list">
        <h3 id="social-friends-list" className="social-section__title">{t.friendsList(friends.length)}</h3>
        {friends.length === 0 ? (
          <EmptyState icon={<Users />} title={t.noFriendsTitle} description={t.noFriendsDescription} />
        ) : (
          <div className="social-list" role="list">
            {friends.map((friend) => (
              <Person key={friend.publicId} user={friend} detail={t.friendSince(longDate(friend.since))}>
                <Button variant="ghost" size="sm" icon={<UserRound />} onClick={() => go({ friend: friend.publicId })}>{t.viewProfile}</Button>
                <Button variant="ghost" size="sm" icon={<MessageCircle />} onClick={() => go({ tab: "chats", chat: friend.publicId, friend: undefined })}>{t.chat}</Button>
                <DropdownMenu
                  label={t.friendMenu(friend.nickname)}
                  align="end"
                  items={[
                    { label: t.unfriend, icon: <UserMinus />, onSelect: () => setConfirm({ kind: "unfriend", user: friend }) },
                    { label: t.block, icon: <Ban />, danger: true, onSelect: () => setConfirm({ kind: "block", user: friend }) }
                  ]}
                  trigger={<IconButton label={t.friendMenu(friend.nickname)} icon={<MoreHorizontal />} size="sm" variant="ghost" />}
                />
              </Person>
            ))}
          </div>
        )}
      </section>

      <ConfirmationModal
        open={Boolean(confirm)}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { kind, user } = confirm;
          setConfirm(null);
          void run(() => (kind === "block" ? social.block(user.publicId) : social.remove(user.publicId)));
        }}
        title={confirm ? (confirm.kind === "block" ? t.blockConfirm(confirm.user.nickname) : t.unfriendConfirm(confirm.user.nickname)) : ""}
        description={confirm?.kind === "block" ? t.blockDescription : t.unfriendDescription}
        confirmLabel={confirm?.kind === "block" ? t.block : t.unfriend}
        tone="danger"
      />
    </div>
  );
}
