import { avatarColorNames, avatarName, avatarUrl, isAvatarColor, isAvatarId, isCharacterAvatar } from "../core/avatars";
import { cx } from "./cx";
import "./Avatar.css";

export type AvatarProps = {
  /** A character or an original variant (`core/avatars`); without it the nickname's initial is shown. */
  avatarId?: string | null;
  /** Circle color id ("coral", "anil"…) for the originals; characters bring their own background. */
  color?: string | null;
  /** Used for the initial fallback and the accessible name. */
  nickname?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Decorative next to a visible name (the default); set a label to announce it. */
  label?: string;
  className?: string;
};

/** Round profile picture: a character, an original on the chosen color, or the initial as a fallback. */
export function Avatar({ avatarId, color, nickname, size = "md", label, className }: AvatarProps) {
  // Characters bring their own background; originals (transparent) sit on the chosen color.
  const tone = isCharacterAvatar(avatarId) ? "art" : isAvatarColor(color) ? color : "grafite";
  const id = isAvatarId(avatarId) ? avatarId : null;
  const initial = (nickname?.trim()[0] ?? "?").toUpperCase();
  return (
    <span
      className={cx("o-avatar", `o-avatar--${size}`, `o-avatar--${tone}`, className)}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      data-avatar={id ?? undefined}
    >
      {id ? <img className="o-avatar__art" src={avatarUrl(id)} alt="" draggable={false} /> : <span className="o-avatar__initial">{initial}</span>}
    </span>
  );
}

/** "Cultivador (variante 2) em Anil", or just the character's name. */
export function avatarDescription(avatarId: string, color: string) {
  const name = avatarName(avatarId);
  if (isCharacterAvatar(avatarId)) return name;
  const tone = isAvatarColor(color) ? avatarColorNames[color] : color;
  return `${name} em ${tone}`;
}
