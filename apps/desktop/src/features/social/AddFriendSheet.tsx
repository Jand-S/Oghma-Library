import { Check, Copy, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { UserCard } from "../../services/socialClient";
import { socialStrings as t } from "../../strings/social";
import { Avatar, Button, Modal, Spinner, cx, useToast } from "../../ui";
import { errorMessage, shortWhen } from "./socialEnv";
import type { SocialController } from "./useSocial";

const LOOKUP_PAUSE = 450;

/**
 * "Adicionar amigo", like Game Center: the exact @nickname (looked up as you pause typing),
 * the card of who was found, your own nickname to share, and the pending requests both ways.
 */
export function AddFriendSheet({ social, open, onClose }: { social: SocialController; open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const [nickname, setNickname] = useState("");
  const [found, setFound] = useState<UserCard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const { friends, incoming, outgoing } = social.friends;
  const name = nickname.trim().replace(/^@/, "");

  useEffect(() => {
    if (!open) return;
    setNickname("");
    setFound(null);
    setError(null);
  }, [open]);

  useEffect(() => {
    setFound(null);
    setError(null);
    if (!name || name.toLowerCase() === social.me?.nickname?.toLowerCase()) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setLooking(true);
      const result = await social.lookup(name);
      if (cancelled) return;
      setLooking(false);
      if (result.ok) setFound(result.value);
      else setError(errorMessage(result.error));
    }, LOOKUP_PAUSE);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      setLooking(false);
    };
  }, [name, social]);

  const run = async (key: string, action: () => Promise<{ ok: boolean; error?: string }>, done?: string) => {
    setBusy(key);
    const result = await action();
    setBusy(null);
    if (!result.ok) toast({ message: errorMessage((result as { error: string }).error), tone: "danger" });
    else if (done) toast({ message: done, tone: "success" });
    return result.ok;
  };

  const sendRequest = async (user: UserCard) => {
    setBusy(user.publicId);
    const result = await social.requestFriend(user.nickname);
    setBusy(null);
    if (!result.ok) {
      setError(errorMessage(result.error));
      return;
    }
    toast({ message: result.value.status === "accepted" ? t.nowFriends(user.nickname) : t.requestSent(user.nickname), tone: "success" });
    setNickname("");
    field.current?.focus();
  };

  const copyNickname = async () => {
    if (!social.me?.nickname) return;
    try {
      await navigator.clipboard.writeText(`@${social.me.nickname}`);
      toast({ message: t.copied, tone: "success" });
    } catch {
      // Clipboard blocked: the nickname is on screen anyway.
    }
  };

  const status = (user: UserCard) =>
    friends.some((friend) => friend.publicId === user.publicId) ? t.alreadyFriends
      : outgoing.some((request) => request.publicId === user.publicId) ? t.waiting
        : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t.addTitle}
      description={t.addHint}
      size="sm"
      initialFocus={field}
      className="social-add-sheet"
      footer={<Button variant="glass" onClick={onClose}>{t.done}</Button>}
    >
      <form
        className={cx("social-handle", found && "is-found", error && "is-error")}
        onSubmit={(event) => {
          event.preventDefault();
          if (found && !status(found)) void sendRequest(found);
        }}
      >
        <span className="social-handle__at" aria-hidden="true">@</span>
        <input
          ref={field}
          aria-label={t.addLabel}
          placeholder={t.addPlaceholder.replace("@", "")}
          value={nickname}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setNickname(event.target.value)}
          data-testid="social-add-input"
        />
        {looking ? <Spinner size="sm" /> : found ? <Check className="social-handle__ok" aria-hidden="true" /> : null}
      </form>
      {error ? <p className="social-error" role="alert">{error}</p> : null}

      {found ? (
        <div className="social-found" data-testid="social-found">
          <Avatar avatarId={found.avatarId} color={found.avatarColor} nickname={found.nickname} size="md" />
          <div className="social-found__text">
            <strong>{found.nickname}</strong>
            {status(found) ? <span>{status(found)}</span> : null}
          </div>
          {status(found) ? null : (
            <Button variant="primary" size="sm" icon={<UserPlus />} loading={busy === found.publicId} onClick={() => void sendRequest(found)} data-testid="social-send-request">
              {t.sendRequest}
            </Button>
          )}
        </div>
      ) : null}

      {social.me?.nickname ? (
        <p className="social-mine-handle">
          {t.yourNickname} <strong>@{social.me.nickname}</strong>
          <Button variant="glass" size="sm" icon={<Copy />} onClick={() => void copyNickname()}>{t.copy}</Button>
        </p>
      ) : null}

      {incoming.length ? (
        <section className="social-requests" aria-labelledby="social-incoming">
          <h3 id="social-incoming" className="social-people__label">{t.incoming}</h3>
          <ul role="list">
            {incoming.map((request) => (
              <li key={request.publicId} className="social-request">
                <Avatar avatarId={request.avatarId} color={request.avatarColor} nickname={request.nickname} size="md" />
                <span className="social-request__text"><strong>{request.nickname}</strong><span>{shortWhen(request.requestedAt)}</span></span>
                <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void run(`d${request.publicId}`, () => social.remove(request.publicId))}>{t.decline}</Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy === `a${request.publicId}`}
                  disabled={busy !== null}
                  onClick={() => void run(`a${request.publicId}`, () => social.accept(request.publicId), t.nowFriends(request.nickname))}
                >
                  {t.accept}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {outgoing.length ? (
        <section className="social-requests" aria-labelledby="social-outgoing">
          <h3 id="social-outgoing" className="social-people__label">{t.outgoing}</h3>
          <ul role="list">
            {outgoing.map((request) => (
              <li key={request.publicId} className="social-request">
                <Avatar avatarId={request.avatarId} color={request.avatarColor} nickname={request.nickname} size="md" />
                <span className="social-request__text"><strong>{request.nickname}</strong><span>{t.waiting}</span></span>
                <Button variant="glass" size="sm" disabled={busy !== null} onClick={() => void run(`c${request.publicId}`, () => social.remove(request.publicId))}>{t.cancelRequest}</Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Modal>
  );
}
