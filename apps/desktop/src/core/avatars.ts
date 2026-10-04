/**
 * Profile avatars: 24 original genre archetypes (SVG in `public/avatars/`, made by
 * `scripts/avatars/generate.py`) on a background color. Same ids and order as the account API
 * (`backend/src/oghma/accounts/profile.py`); a test keeps them in step.
 */
export const avatarIds = [
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

export type AvatarId = (typeof avatarIds)[number];

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

export const avatarNames: Record<AvatarId, string> = {
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

export function isAvatarId(value: unknown): value is AvatarId {
  return typeof value === "string" && (avatarIds as readonly string[]).includes(value);
}

export function isAvatarColor(value: unknown): value is AvatarColor {
  return typeof value === "string" && (avatarColors as readonly string[]).includes(value);
}

/** A random avatar and color: a new account starts with one already picked. */
export function randomAvatar(random: () => number = Math.random): { avatarId: AvatarId; avatarColor: AvatarColor } {
  return {
    avatarId: avatarIds[Math.floor(random() * avatarIds.length)],
    avatarColor: avatarColors[Math.floor(random() * avatarColors.length)]
  };
}

export function avatarUrl(id: AvatarId) {
  return `/avatars/${id}.svg`;
}
