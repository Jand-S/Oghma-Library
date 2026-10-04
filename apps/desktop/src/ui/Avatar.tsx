import { avatarColorNames, avatarNames, avatarUrl, isAvatarColor, isAvatarId, isCharacterAvatar } from "../core/avatars";
import { cx } from "./cx";
import "./Avatar.css";

export type AvatarProps = {
  /** One of the 24 archetypes; without it the nickname's initial is shown. */
  avatarId?: string | null;
  /** Background color id ("coral", "anil"…). */
  color?: string | null;
  /** Used for the initial fallback and the accessible name. */
  nickname?: string | null;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  /** Decorative next to a visible name (the default); set a label to announce it. */
  label?: string;
  className?: string;
};

/** Round profile picture: an archetype bust on a solid color, or the initial as a fallback. */
export function Avatar({ avatarId, color, nickname, size = "md", label, className }: AvatarProps) {
  // Characters bring their own background; archetypes sit on the chosen color.
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

/** "Mago reencarnado em Anil", for pickers. */
export function avatarDescription(avatarId: string, color: string) {
  const name = isAvatarId(avatarId) ? avatarNames[avatarId] : avatarId;
  if (isCharacterAvatar(avatarId)) return name;
  const tone = isAvatarColor(color) ? avatarColorNames[color] : color;
  return `${name} em ${tone}`;
}
