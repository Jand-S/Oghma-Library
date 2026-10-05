import catalog from "./avatarCatalog.json";

/**
 * Profile avatars, from `avatarCatalog.json` (written by `scripts/avatars/build.py` from the ComfyUI
 * renders). Two sets:
 * - **characters**: novel protagonists and antagonists, each with its own background
 *   (`public/avatars/personagens/<id>.webp`). Fan art for personal use.
 * - **originals**: the Oghma's own archetypes, each with 1–4 variants on a transparent background
 *   (`public/avatars/originais/<arq>-<n>.webp`), drawn on the circle color the reader picks.
 * The account API accepts the same ids (`backend/src/oghma/accounts/avatars.json`).
 */
export type CharacterAvatar = { id: string; name: string };
export type OriginalAvatar = { id: string; name: string; genre: string; variants: string[] };

export const characterAvatars: CharacterAvatar[] = catalog.characters;
export const originalAvatars: OriginalAvatar[] = catalog.originals;

export const avatarColors = catalog.colors as readonly string[];
export type AvatarColor = string;

export const avatarColorNames: Record<string, string> = {
  coral: "Coral",
  tangerina: "Tangerina",
  ambar: "Âmbar",
  lima: "Lima",
  menta: "Menta",
  turquesa: "Turquesa",
  celeste: "Celeste",
  anil: "Anil",
  lavanda: "Lavanda",
  orquidea: "Orquídea",
  rosa: "Rosa",
  grafite: "Grafite"
};

const characterIds = new Set(characterAvatars.map((avatar) => avatar.id));
/** Variant id ("cultivador-2") → its archetype. */
const originalOf = new Map(originalAvatars.flatMap((arq) => arq.variants.map((variant) => [variant, arq] as const)));

export function isCharacterAvatar(value: unknown): value is string {
  return typeof value === "string" && characterIds.has(value);
}

export function isOriginalAvatar(value: unknown): value is string {
  return typeof value === "string" && originalOf.has(value);
}

export function isAvatarId(value: unknown): value is string {
  return isCharacterAvatar(value) || isOriginalAvatar(value);
}

export function isAvatarColor(value: unknown): value is string {
  return typeof value === "string" && avatarColors.includes(value);
}

/** The archetype of a variant id ("cultivador-2" → Cultivador). */
export function originalOfVariant(id: string): OriginalAvatar | undefined {
  return originalOf.get(id);
}

/** "Megumin", or "Cultivador (variante 2)". */
export function avatarName(id: string): string {
  const character = characterAvatars.find((avatar) => avatar.id === id);
  if (character) return character.name;
  const arq = originalOf.get(id);
  if (!arq) return id;
  return arq.variants.length > 1 ? `${arq.name} (variante ${arq.variants.indexOf(id) + 1})` : arq.name;
}

export function avatarUrl(id: string) {
  return isCharacterAvatar(id) ? `/avatars/personagens/${id}.webp` : `/avatars/originais/${id}.webp`;
}

/** A random avatar for a new profile: any character, or any original variant on any color. */
export function randomAvatar(random: () => number = Math.random): { avatarId: string; avatarColor: string | null } {
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const variants = originalAvatars.flatMap((arq) => arq.variants);
  const id = pick([...characterAvatars.map((avatar) => avatar.id), ...variants]);
  return { avatarId: id, avatarColor: isOriginalAvatar(id) ? pick(avatarColors) : null };
}
