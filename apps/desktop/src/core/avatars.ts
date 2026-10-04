/**
 * Profile avatars. The picker offers the 24 characters (`public/avatars/personagens/`, made by
 * `scripts/avatars/characters.py`), each with its own fixed background. The 24 original archetypes
 * (`public/avatars/`, `scripts/avatars/archetypes.py`, drawn on a chosen color) are kept: profiles
 * that already use one still show it, and they are the set for a public release.
 * Same ids and order as the account API (`backend/src/oghma/accounts/profile.py`); a test keeps them in step.
 */
export const characterAvatarIds = [
  "sung-jinwoo",
  "emilia",
  "subaru",
  "rem",
  "kirito",
  "asuna",
  "ainz",
  "albedo",
  "kim-dokja",
  "holo",
  "klein-moretti",
  "megumin",
  "naofumi",
  "raphtalia",
  "ayanokouji",
  "horikita",
  "wei-wuxian",
  "roxy",
  "shadow",
  "elaina",
  "betelgeuse",
  "violet",
  "sunny",
  "mai"
] as const;

export type CharacterAvatarId = (typeof characterAvatarIds)[number];

export const characterNames: Record<CharacterAvatarId, string> = {
  "sung-jinwoo": "Sung Jinwoo",
  emilia: "Emilia",
  subaru: "Natsuki Subaru",
  rem: "Rem",
  kirito: "Kirito",
  asuna: "Asuna",
  ainz: "Ainz Ooal Gown",
  albedo: "Albedo",
  "kim-dokja": "Kim Dokja",
  holo: "Holo",
  "klein-moretti": "Klein Moretti",
  megumin: "Megumin",
  naofumi: "Naofumi Iwatani",
  raphtalia: "Raphtalia",
  ayanokouji: "Kiyotaka Ayanokouji",
  horikita: "Suzune Horikita",
  "wei-wuxian": "Wei Wuxian",
  roxy: "Roxy Migurdia",
  shadow: "Shadow",
  elaina: "Elaina",
  betelgeuse: "Betelgeuse",
  violet: "Violet Evergarden",
  sunny: "Sunless",
  mai: "Mai Sakurajima"
};

export const archetypeAvatarIds = [
  "cultivador",
  "mestra-seita",
  "mago-reencarnado",
  "vila-otome",
  "regressor",
  "cacadora",
  "detetive",
  "alquimista",
  "princesa-guerreira",
  "necromante",
  "estudante-academia",
  "espadachim",
  "rainha-demonio",
  "ferreiro-anao",
  "elfa-arqueira",
  "hacker-vrmmo",
  "sacerdotisa",
  "cavaleiro-negro",
  "bruxa",
  "samurai",
  "kunoichi",
  "monge",
  "vampira",
  "piloto-estelar"
] as const;

export type ArchetypeAvatarId = (typeof archetypeAvatarIds)[number];
export type AvatarId = CharacterAvatarId | ArchetypeAvatarId;

/** What the profile picker offers. */
export const avatarIds = characterAvatarIds;

export const avatarColors = [
  "coral",
  "tangerina",
  "ambar",
  "lima",
  "menta",
  "turquesa",
  "celeste",
  "anil",
  "lavanda",
  "orquidea",
  "rosa",
  "grafite"
] as const;

export type AvatarColor = (typeof avatarColors)[number];

const archetypeNames: Record<ArchetypeAvatarId, string> = {
  cultivador: "Cultivador",
  "mestra-seita": "Mestra de seita",
  "mago-reencarnado": "Mago reencarnado",
  "vila-otome": "Vilã de otome",
  regressor: "Regressor",
  cacadora: "Caçadora de masmorras",
  detetive: "Detetive",
  alquimista: "Alquimista",
  "princesa-guerreira": "Princesa guerreira",
  necromante: "Necromante",
  "estudante-academia": "Estudante da academia",
  espadachim: "Espadachim errante",
  "rainha-demonio": "Rainha demônio",
  "ferreiro-anao": "Ferreiro anão",
  "elfa-arqueira": "Elfa arqueira",
  "hacker-vrmmo": "Hacker de VRMMO",
  sacerdotisa: "Sacerdotisa",
  "cavaleiro-negro": "Cavaleiro negro",
  bruxa: "Bruxa",
  samurai: "Samurai",
  kunoichi: "Kunoichi",
  monge: "Monge",
  vampira: "Vampira",
  "piloto-estelar": "Piloto estelar"
};

export const avatarColorNames: Record<AvatarColor, string> = {
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

export const avatarNames: Record<AvatarId, string> = { ...archetypeNames, ...characterNames };

export function isCharacterAvatar(value: unknown): value is CharacterAvatarId {
  return typeof value === "string" && (characterAvatarIds as readonly string[]).includes(value);
}

export function isAvatarId(value: unknown): value is AvatarId {
  return isCharacterAvatar(value) || (typeof value === "string" && (archetypeAvatarIds as readonly string[]).includes(value));
}

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === "string" && (avatarColors as readonly string[]).includes(value);
}

/** A random character: a new profile starts with one already picked. */
export function randomAvatar(random: () => number = Math.random): CharacterAvatarId {
  return characterAvatarIds[Math.floor(random() * characterAvatarIds.length)];
}

export function avatarUrl(id: AvatarId) {
  return isCharacterAvatar(id) ? `/avatars/personagens/${id}.svg` : `/avatars/${id}.svg`;
}
