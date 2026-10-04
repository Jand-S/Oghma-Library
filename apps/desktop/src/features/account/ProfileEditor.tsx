import { Check, Loader2, Shuffle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { avatarIds, avatarNames, randomAvatar, type AvatarId, isAvatarId } from "../../core/avatars";
import { oghmaAccountStrings as s } from "../../strings/oghmaAccount";
import { Avatar, Button, TextField, cx } from "../../ui";

/** `avatarColor` only matters for an archived archetype a profile still uses (characters have their own background). */
export type ProfileDraft = { nickname: string; avatarId: AvatarId; avatarColor?: string };

type NicknameCheck = { available: boolean; reason: string | null; suggestions: string[] } | null;

const NICKNAME_RE = /^[\p{L}\p{N}](?:[\p{L}\p{N}_.]*[\p{L}\p{N}])?$/u;

/** Same rules as the server (`profile.py`), so most problems show before any request. */
export function localNicknameProblem(value: string): string | null {
  const nickname = value.trim();
  if (nickname.length < 3) return "nickname_too_short";
  if (nickname.length > 20) return "nickname_too_long";
  if (!NICKNAME_RE.test(nickname) || nickname.includes("..")) return "nickname_invalid_chars";
  return null;
}

type ProfileEditorProps = {
  initial?: { nickname?: string | null; avatarId?: string | null; avatarColor?: string | null };
  /** Server check ("GET /v1/nicknames/<n>/available"); null when it could not be checked. */
  checkNickname: (nickname: string) => Promise<NicknameCheck>;
  onChange: (draft: ProfileDraft, valid: boolean) => void;
  /** Error from saving (e.g. taken between the check and the save). */
  saveError?: string | null;
};

/**
 * Nickname with a live availability check and the character grid, around a large preview.
 * A new profile starts with a random character already picked; "Sortear" draws another.
 */
export function ProfileEditor({ initial, checkNickname, onChange, saveError }: ProfileEditorProps) {
  const [picked] = useState(() => randomAvatar());
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [avatarId, setAvatarId] = useState<AvatarId>(isAvatarId(initial?.avatarId) ? initial!.avatarId as AvatarId : picked);
  const avatarColor = initial?.avatarColor ?? undefined;
  const [check, setCheck] = useState<{ value: string; result: NicknameCheck } | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);

  const trimmed = nickname.trim();
  const unchanged = Boolean(initial?.nickname) && trimmed === initial?.nickname;
  const localProblem = trimmed ? localNicknameProblem(trimmed) : null;

  // Availability, 400 ms after the last keystroke.
  useEffect(() => {
    if (!trimmed || localProblem || unchanged) {
      setChecking(false);
      return;
    }
    const id = ++seq.current;
    setChecking(true);
    const timer = window.setTimeout(() => {
      void checkNickname(trimmed).then((result) => {
        if (id !== seq.current) return;
        setCheck({ value: trimmed, result });
        setChecking(false);
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [checkNickname, localProblem, trimmed, unchanged]);

  const current = check?.value === trimmed ? check.result : null;
  const serverProblem = current && !current.available ? `nickname_${current.reason ?? "taken"}` : null;
  const problem = localProblem ?? serverProblem;
  const valid = Boolean(trimmed) && !problem && (unchanged || (!checking && current !== null && current.available));

  useEffect(() => {
    onChange({ nickname: trimmed, avatarId, avatarColor }, valid);
  }, [avatarColor, avatarId, onChange, trimmed, valid]);

  const shuffle = () => {
    let next = randomAvatar();
    while (next === avatarId) next = randomAvatar();
    setAvatarId(next);
  };

  let status = null;
  if (trimmed && !localProblem && !unchanged) {
    if (checking) status = <span className="profile-nick__status"><Loader2 className="is-spinning" aria-hidden="true" />{s.nicknameChecking}</span>;
    else if (current?.available) status = <span className="profile-nick__status is-ok"><Check aria-hidden="true" />{s.nicknameAvailable}</span>;
    else if (serverProblem) status = <span className="profile-nick__status is-bad"><X aria-hidden="true" />{s.errors[serverProblem] ?? s.nicknameTaken}</span>;
  }
  const errorText = saveError ?? (localProblem && trimmed.length > 0 ? s.errors[localProblem] : null);

  return (
    <div className="profile-editor">
      <div className="profile-editor__preview">
        <Avatar avatarId={avatarId} color={avatarColor} nickname={trimmed} size="xl" />
        <div className={cx("profile-editor__name", !trimmed && "is-placeholder")} aria-live="polite">{trimmed || s.nicknamePlaceholder}</div>
      </div>

      <div className="profile-nick">
        <TextField
          label={s.nicknameLabel}
          placeholder={s.nicknamePlaceholder}
          value={nickname}
          maxLength={20}
          autoComplete="nickname"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(event) => setNickname(event.target.value)}
          hint={errorText ? undefined : s.nicknameHelp}
          error={errorText ?? undefined}
          data-testid="profile-nickname"
        />
        <div className="profile-nick__line" role="status">
          {status}
          {current && !current.available && current.suggestions.length ? (
            <span className="profile-nick__suggestions">
              {s.nicknameSuggestions}
              {current.suggestions.map((suggestion) => (
                <button key={suggestion} type="button" className="profile-nick__suggestion" onClick={() => setNickname(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </span>
          ) : null}
        </div>
      </div>


      <section className="profile-picker" aria-label={s.avatarLabel}>
        <div className="profile-picker__head">
          <span className="profile-picker__title">{s.avatarLabel}</span>
          <Button size="sm" variant="ghost" icon={<Shuffle />} onClick={shuffle} data-testid="profile-shuffle">{s.shuffle}</Button>
        </div>
        <div className="profile-avatars" role="radiogroup" aria-label={s.avatarLabel}>
          {avatarIds.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === avatarId}
              aria-label={avatarNames[id]}
              title={avatarNames[id]}
              className={cx("profile-avatars__option", id === avatarId && "is-selected")}
              onClick={() => setAvatarId(id)}
            >
              <Avatar avatarId={id} size="lg" />
            </button>
          ))}
        </div>
      </section>

    </div>
  );
}
