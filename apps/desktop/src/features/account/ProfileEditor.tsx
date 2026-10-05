import { Check, Loader2, Shuffle, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  avatarColorNames,
  avatarColors,
  avatarName,
  characterAvatars,
  isAvatarColor,
  isAvatarId,
  isOriginalAvatar,
  originalAvatars,
  originalOfVariant,
  randomAvatar
} from "../../core/avatars";
import { oghmaAccountStrings as s } from "../../strings/oghmaAccount";
import { Avatar, Button, SegmentedControl, TextField, cx } from "../../ui";

/** `avatarColor` is the circle color of an original (characters have their own background). */
export type ProfileDraft = { nickname: string; avatarId: string; avatarColor?: string };

type PickerTab = "characters" | "originals";

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
 * Nickname with a live availability check and the avatar picker, around a large preview.
 * Two tabs: characters (own background) and the Oghma's originals (archetype → variant → circle
 * color). A new profile starts with a random avatar already picked; "Sortear" draws another.
 */
export function ProfileEditor({ initial, checkNickname, onChange, saveError }: ProfileEditorProps) {
  const [picked] = useState(() => randomAvatar());
  const startsOwn = isAvatarId(initial?.avatarId);
  const [nickname, setNickname] = useState(initial?.nickname ?? "");
  const [avatarId, setAvatarId] = useState<string>(startsOwn ? initial!.avatarId! : picked.avatarId);
  const [color, setColor] = useState<string>(
    isAvatarColor(initial?.avatarColor) ? initial!.avatarColor! : picked.avatarColor ?? avatarColors[0]
  );
  const [tab, setTab] = useState<PickerTab>(isOriginalAvatar(avatarId) ? "originals" : "characters");
  const original = originalOfVariant(avatarId);
  const avatarColor = original ? color : undefined;
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
    while (next.avatarId === avatarId) next = randomAvatar();
    setAvatarId(next.avatarId);
    if (next.avatarColor) setColor(next.avatarColor);
    setTab(isOriginalAvatar(next.avatarId) ? "originals" : "characters");
  };
  /** Picking an archetype keeps its variant if one of its variants is already chosen. */
  const pickOriginal = (arqId: string) => {
    if (originalOfVariant(avatarId)?.id === arqId) return;
    const arq = originalAvatars.find((item) => item.id === arqId);
    if (arq) setAvatarId(arq.variants[0]);
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
          <SegmentedControl<PickerTab>
            aria-label={s.avatarLabel}
            size="sm"
            value={tab}
            onChange={setTab}
            options={[
              { value: "characters", label: s.tabCharacters },
              { value: "originals", label: s.tabOriginals }
            ]}
          />
          <Button size="sm" variant="ghost" icon={<Shuffle />} onClick={shuffle} data-testid="profile-shuffle">{s.shuffle}</Button>
        </div>

        {tab === "characters" ? (
          <div className="profile-avatars" role="radiogroup" aria-label={s.tabCharacters} data-testid="profile-characters">
            {characterAvatars.map((avatar) => (
              <button
                key={avatar.id}
                type="button"
                role="radio"
                aria-checked={avatar.id === avatarId}
                aria-label={avatar.name}
                title={avatar.name}
                className={cx("profile-avatars__option", avatar.id === avatarId && "is-selected")}
                onClick={() => setAvatarId(avatar.id)}
              >
                <Avatar avatarId={avatar.id} size="lg" />
              </button>
            ))}
          </div>
        ) : (
          <>
            <div className="profile-avatars" role="radiogroup" aria-label={s.tabOriginals} data-testid="profile-originals">
              {originalAvatars.map((arq) => {
                const selected = original?.id === arq.id;
                const shown = selected ? avatarId : arq.variants[0];
                return (
                  <button
                    key={arq.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={arq.name}
                    title={`${arq.name} · ${arq.genre}`}
                    className={cx("profile-avatars__option", selected && "is-selected")}
                    onClick={() => pickOriginal(arq.id)}
                  >
                    <Avatar avatarId={shown} color={color} size="lg" />
                  </button>
                );
              })}
            </div>
            {original ? (
              <div className="profile-original" data-testid="profile-original-options">
                {original.variants.length > 1 ? (
                  <div className="profile-picker__row">
                    <span className="profile-picker__title">{s.variantLabel}</span>
                    <div className="profile-variants" role="radiogroup" aria-label={s.variantLabel}>
                      {original.variants.map((variant) => (
                        <button
                          key={variant}
                          type="button"
                          role="radio"
                          aria-checked={variant === avatarId}
                          aria-label={avatarName(variant)}
                          title={avatarName(variant)}
                          className={cx("profile-variants__option", variant === avatarId && "is-selected")}
                          onClick={() => setAvatarId(variant)}
                        >
                          <Avatar avatarId={variant} color={color} size="md" />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="profile-picker__row">
                  <span className="profile-picker__title">{s.colorLabel}</span>
                  <div className="profile-colors" role="radiogroup" aria-label={s.colorLabel}>
                    {avatarColors.map((tone) => (
                      <button
                        key={tone}
                        type="button"
                        role="radio"
                        aria-checked={tone === color}
                        aria-label={avatarColorNames[tone] ?? tone}
                        title={avatarColorNames[tone] ?? tone}
                        className={cx("profile-colors__swatch", `o-avatar--${tone}`, tone === color && "is-selected")}
                        onClick={() => setColor(tone)}
                      >
                        {tone === color ? <Check aria-hidden="true" /> : null}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <p className="profile-picker__hint">{s.pickOriginalHint}</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
