import type { ContentRatingFilter, Novel, TagCatalogItem } from "./types";

export type TagFilterDraft = {
  includeTags: string[];
  excludeTags: string[];
};

const categoryFallback = (key: string): TagCatalogItem["category"] => {
  if (key.startsWith("format.")) return "format";
  if (key.startsWith("genre.")) return "genre";
  return "theme";
};

type CanonicalTag = Pick<TagCatalogItem, "key" | "label" | "category"> & {
  aliases: string[];
};

const canonicalTags: CanonicalTag[] = [
  { key: "format.light_novel", label: "Light Novel", category: "format", aliases: ["light novel", "lightnovel"] },
  { key: "format.webnovel", label: "Webnovel", category: "format", aliases: ["web novel", "webnovel", "webnovela"] },
  { key: "format.original", label: "Original", category: "format", aliases: ["original novel"] },
  { key: "format.one_shot", label: "One-shot", category: "format", aliases: ["one shot", "oneshot", "one-shot"] },
  { key: "format.anthology", label: "Antologia", category: "format", aliases: ["anthology"] },
  { key: "format.short_story", label: "Conto", category: "format", aliases: ["short story", "short stories"] },
  { key: "format.fan_fiction", label: "Fan-fiction", category: "format", aliases: ["fan fiction", "fanfiction"] },
  { key: "format.full_color", label: "Colorido", category: "format", aliases: ["full color", "full colour", "colorida"] },
  { key: "format.official_colored", label: "Colorido Oficial", category: "format", aliases: ["official colored", "official coloured"] },
  { key: "format.long_strip", label: "Long Strip", category: "format", aliases: ["long strip"] },
  { key: "format.doujinshi", label: "Doujinshi", category: "format", aliases: ["doujinshi"] },
  { key: "format.adapted_anime", label: "Adaptado para Anime", category: "format", aliases: ["adaptado para anime", "adaptado para um anime", "adapted to anime"] },
  { key: "format.adapted_manga", label: "Adaptado para Mangá", category: "format", aliases: ["adaptado para manga", "adaptado para um manga", "adapted to manga"] },
  { key: "format.adapted_manhwa", label: "Adaptado para Manhwa", category: "format", aliases: ["adaptado para manhwa", "adaptado para um manhwa", "adapted to manhwa"] },
  { key: "format.adapted_manhua", label: "Adaptado para Manhua", category: "format", aliases: ["adaptado para manhua", "adaptado para um manhua", "adaptado de um manhua", "adapted to manhua"] },
  { key: "format.adapted_movie", label: "Adaptado para Filme", category: "format", aliases: ["adaptado para filme", "adaptado para um filme", "adapted to movie"] },
  { key: "format.adapted_game", label: "Adaptado para Jogo", category: "format", aliases: ["adaptado para jogo", "adaptado para um jogo", "adapted to game"] },
  { key: "format.adapted_drama", label: "Adaptado para Drama", category: "format", aliases: ["adaptado para drama", "adaptado para um drama", "adapted to drama"] },
  { key: "format.brazilian", label: "Brasileira", category: "format", aliases: ["brasileira", "brazilian", "brasil"] },
  { key: "format.chinese", label: "Chinesa", category: "format", aliases: ["chinesa", "chinese", "china"] },
  { key: "format.korean", label: "Coreana", category: "format", aliases: ["coreana", "korean", "korea"] },
  { key: "format.japanese", label: "Japonesa", category: "format", aliases: ["japonesa", "japanese", "japan"] },
  { key: "genre.action", label: "Ação", category: "genre", aliases: ["acao", "ação", "action"] },
  { key: "genre.adventure", label: "Aventura", category: "genre", aliases: ["aventura", "adventure"] },
  { key: "genre.fantasy", label: "Fantasia", category: "genre", aliases: ["fantasia", "fantasy"] },
  { key: "genre.romance", label: "Romance", category: "genre", aliases: ["romance"] },
  { key: "genre.drama", label: "Drama", category: "genre", aliases: ["drama"] },
  { key: "genre.comedy", label: "Comédia", category: "genre", aliases: ["comedia", "comédia", "comedy"] },
  { key: "genre.mystery", label: "Mistério", category: "genre", aliases: ["misterio", "mistério", "mystery"] },
  { key: "genre.psychological", label: "Psicológico", category: "genre", aliases: ["psicologico", "psicológico", "psychological"] },
  { key: "genre.horror", label: "Terror", category: "genre", aliases: ["terror", "horror"] },
  { key: "genre.thriller", label: "Suspense", category: "genre", aliases: ["suspense", "thriller"] },
  { key: "genre.sci_fi", label: "Ficção Científica", category: "genre", aliases: ["ficcao cientifica", "ficção científica", "sci-fi", "sci fi", "sci-fi"] },
  { key: "genre.tragedy", label: "Tragédia", category: "genre", aliases: ["tragedia", "tragédia", "tragedy"] },
  { key: "genre.slice_of_life", label: "Cotidiano", category: "genre", aliases: ["cotidiano", "slice of life", "vida cotidiana"] },
  { key: "genre.dark_fantasy", label: "Fantasia Sombria", category: "genre", aliases: ["dark fantasy", "fantasia sombria"] },
  { key: "genre.urban_fantasy", label: "Fantasia Urbana", category: "genre", aliases: ["urban fantasy", "fantasia urbana"] },
  { key: "genre.historical", label: "Histórico", category: "genre", aliases: ["historico", "histórico", "historical"] },
  { key: "genre.military", label: "Militar", category: "genre", aliases: ["militar", "military"] },
  { key: "genre.martial_arts", label: "Artes Marciais", category: "genre", aliases: ["artes marciais", "martial arts"] },
  { key: "genre.sports", label: "Esporte", category: "genre", aliases: ["esporte", "sports"] },
  { key: "genre.mecha", label: "Mecha", category: "genre", aliases: ["mecha"] },
  { key: "genre.medical", label: "Médico", category: "genre", aliases: ["medico", "médico", "medical"] },
  { key: "genre.philosophical", label: "Filosófico", category: "genre", aliases: ["filosofico", "filosófico", "philosophical"] },
  { key: "genre.isekai", label: "Isekai", category: "genre", aliases: ["isekai"] },
  { key: "genre.wuxia", label: "Wuxia", category: "genre", aliases: ["wuxia"] },
  { key: "genre.xianxia", label: "Xianxia", category: "genre", aliases: ["xianxia"] },
  { key: "genre.xuanhuan", label: "Xuanhuan", category: "genre", aliases: ["xuanhuan"] },
  { key: "genre.cultivation", label: "Cultivo", category: "genre", aliases: ["cultivo", "cultivation"] },
  { key: "genre.shounen", label: "Shounen", category: "genre", aliases: ["shounen", "shonen"] },
  { key: "genre.shoujo", label: "Shoujo", category: "genre", aliases: ["shoujo", "shojo"] },
  { key: "genre.seinen", label: "Seinen", category: "genre", aliases: ["seinen"] },
  { key: "genre.josei", label: "Josei", category: "genre", aliases: ["josei"] },
  { key: "genre.boys_love", label: "Boys Love", category: "genre", aliases: ["boys love", "boy's love", "bl", "yaoi"] },
  { key: "genre.girls_love", label: "Girls Love", category: "genre", aliases: ["girls love", "girl's love", "gl", "yuri"] },
  { key: "genre.adult", label: "Adulto", category: "genre", aliases: ["adulto", "adult", "mature", "18+", "+18", "publico adulto", "público adulto"] },
  { key: "genre.ecchi", label: "Ecchi", category: "genre", aliases: ["ecchi"] },
  { key: "genre.erotic", label: "Erótico", category: "genre", aliases: ["erotico", "erótico", "smut"] },
  { key: "genre.explicit_erotic", label: "Erótico Explícito", category: "genre", aliases: ["heavy smut", "explicit smut", "erotico explicito"] },
  { key: "genre.supernatural", label: "Sobrenatural", category: "genre", aliases: ["sobrenatural", "supernatural"] },
  { key: "theme.harem", label: "Harém", category: "theme", aliases: ["harem", "harém"] },
  { key: "theme.reverse_harem", label: "Harém Reverso", category: "theme", aliases: ["reverse harem", "harem reverso", "harém reverso"] },
  { key: "theme.character_growth", label: "Crescimento do Personagem", category: "theme", aliases: ["character growth", "crescimento do personagem"] },
  { key: "theme.clever_protagonist", label: "Protagonista Inteligente", category: "theme", aliases: ["clever protagonist", "smart protagonist", "protagonista inteligente"] },
  { key: "theme.cunning_protagonist", label: "Protagonista Astuto", category: "theme", aliases: ["cunning protagonist", "protagonista astuto"] },
  { key: "theme.aristocracy", label: "Aristocracia", category: "theme", aliases: ["aristocracy", "aristocracia"] },
  { key: "theme.magic", label: "Magia", category: "theme", aliases: ["magia", "magic", "magica", "mágica"] },
  { key: "theme.black_magic", label: "Magia Negra", category: "theme", aliases: ["black magic", "magia negra"] },
  { key: "theme.reincarnation", label: "Reencarnação", category: "theme", aliases: ["reencarnacao", "reencarnação", "reincarnation"] },
  { key: "theme.transmigration", label: "Transmigração", category: "theme", aliases: ["transmigracao", "transmigração", "transmigration"] },
  { key: "theme.system", label: "Sistema", category: "theme", aliases: ["sistema", "system"] },
  { key: "theme.level_system", label: "Sistema de Nível", category: "theme", aliases: ["sistema de nivel", "sistema de nível", "level system"] },
  { key: "theme.knights", label: "Cavaleiros", category: "theme", aliases: ["knights", "cavaleiros"] },
  { key: "theme.nobles", label: "Nobres", category: "theme", aliases: ["nobles", "nobres", "nobreza"] },
  { key: "theme.game_elements", label: "Elementos de Jogos", category: "theme", aliases: ["elementos de jogos", "game elements", "sistema de jogo"] },
  { key: "theme.school_life", label: "Vida Escolar", category: "theme", aliases: ["vida escolar", "school life", "escolar"] },
  { key: "theme.female_protagonist", label: "Protagonista Feminina", category: "theme", aliases: ["protagonista feminina", "female protagonist"] },
  { key: "theme.male_protagonist", label: "Protagonista Masculino", category: "theme", aliases: ["protagonista masculino", "male protagonist"] },
  { key: "theme.evil_protagonist", label: "Protagonista Maligno", category: "theme", aliases: ["protagonista maligno", "evil protagonist"] },
  { key: "theme.overpowered_protagonist", label: "Protagonista Super Poderoso", category: "theme", aliases: ["overpowered protagonist", "op protagonist"] },
  { key: "theme.monsters", label: "Monstros", category: "theme", aliases: ["monstros", "monsters"] },
  { key: "theme.demons", label: "Demônios", category: "theme", aliases: ["demonios", "demônios", "demons"] },
  { key: "theme.dragons", label: "Dragões", category: "theme", aliases: ["dragoes", "dragões", "dragons"] },
  { key: "theme.gods", label: "Deuses", category: "theme", aliases: ["deuses", "gods"] },
  { key: "theme.dungeons", label: "Calabouços", category: "theme", aliases: ["calaboucos", "calabouços", "dungeons"] },
  { key: "theme.guilds", label: "Guildas", category: "theme", aliases: ["guilds", "guildas"] },
  { key: "theme.politics", label: "Política", category: "theme", aliases: ["politics", "politica", "política"] },
  { key: "theme.mercenaries", label: "Mercenários", category: "theme", aliases: ["mercenaries", "mercenarios", "mercenários"] },
  { key: "theme.academy", label: "Academia", category: "theme", aliases: ["academia", "academy"] },
  { key: "theme.apocalypse", label: "Apocalipse", category: "theme", aliases: ["apocalipse", "apocalypse"] },
  { key: "theme.post_apocalyptic", label: "Pós-apocalíptico", category: "theme", aliases: ["pos-apocaliptico", "pós-apocalíptico", "post-apocalyptic"] },
  { key: "theme.villainess", label: "Vilã", category: "theme", aliases: ["vila", "vilã", "vilao", "vilão", "villainess"] },
  { key: "theme.redemption", label: "Redenção", category: "theme", aliases: ["redemption", "redencao", "redenção"] },
  { key: "theme.revenge", label: "Vingança", category: "theme", aliases: ["revenge", "vinganca", "vingança"] },
  { key: "theme.second_chance", label: "Segunda Chance", category: "theme", aliases: ["second chance", "segunda chance"] },
  { key: "theme.weak_to_strong", label: "Fraco a Forte", category: "theme", aliases: ["weak to strong", "fraco a forte"] },
  { key: "theme.gender_bender", label: "Gender Bender", category: "theme", aliases: ["gender bender"] },
  { key: "theme.virtual_reality", label: "Realidade Virtual", category: "theme", aliases: ["realidade virtual", "virtual reality", "vrmmo"] }
];

const canonicalByAlias = new Map<string, CanonicalTag>();
for (const tag of canonicalTags) {
  canonicalByAlias.set(normalizeSearchText(tag.label), tag);
  for (const alias of tag.aliases) canonicalByAlias.set(normalizeSearchText(alias), tag);
}
const canonicalByKey = new Map(canonicalTags.map((tag) => [tag.key, tag]));

export function normalizeSearchText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function rawTagKey(label: string) {
  const canonical = canonicalByAlias.get(normalizeSearchText(label));
  if (canonical) return canonical.key;
  const normalized = normalizeSearchText(label).replace(/\s+/g, ".");
  return normalized ? `raw.${normalized}` : "raw.unknown";
}

function canonicalForKey(key: string) {
  return canonicalByKey.get(key);
}

export function canonicalizeTagKey(key: string, label?: string): string {
  if (canonicalByKey.has(key)) return key;
  if (label) {
    const byLabel = canonicalByAlias.get(normalizeSearchText(label));
    if (byLabel) return byLabel.key;
  }
  const readable = key
    .replace(/^raw\./, "")
    .replace(/^(format|genre|theme)\./, "")
    .replace(/[._-]+/g, " ");
  const byKeyText = canonicalByAlias.get(normalizeSearchText(readable));
  return byKeyText?.key ?? key;
}

export function tagKeysForNovel(novel: Pick<Novel, "tags" | "tagKeys">): string[] {
  // Keys and labels are canonicalized on their own: the backend drops duplicates and empty
  // tags from tagKeys, so pairing tagKeys[i] with tags[i] gave a label to the wrong key.
  const keys = (novel.tagKeys ?? []).map((key) => canonicalizeTagKey(key));
  const fromLabels = novel.tags.map(rawTagKey);
  return [...new Set([...keys, ...(keys.length ? fromLabels.filter((key) => !key.startsWith("raw.")) : fromLabels)])];
}

/** Display label and aliases of a canonical tag key (for full-text search); empty for raw keys. */
export function canonicalTagText(key: string): string[] {
  const tag = canonicalForKey(key);
  return tag ? [tag.label, ...tag.aliases] : [];
}

export function matchesTagFilters(novel: Novel, includeTags: string[], excludeTags: string[]) {
  const keys = tagKeysForNovel(novel);
  return includeTags.every((key) => keys.includes(key))
    && excludeTags.every((key) => !keys.includes(key));
}

// "Adulto"/"Adult"/"Mature" (genre.adult) means mature themes on most sources: Central Novel
// puts it on Omniscient Reader, Against the Gods, All You Need Is Kill. It is its own level, not
// erotic. An explicit age mark ("+18", "18+", "Adult Only") and sexual tags stay erotic.
const matureTagKeys = new Set(["genre.adult"]);

const matureTagText = new Set(["adult", "adulto", "mature", "maduro", "publico adulto"]);

const eroticTagKeys = new Set([
  "genre.erotic",
  "genre.explicit_erotic",
  "theme.bdsm",
  "theme.dirty_talk",
  "theme.dominance",
  "theme.incest",
  "theme.milf",
  "theme.dilf",
  "theme.nonconsensual",
  "theme.sex_friends",
  "theme.sex_slaves",
  "theme.threesome",
  "theme.voyeurism"
]);

const suggestiveTagKeys = new Set([
  "genre.ecchi",
  "theme.cross_dressing",
  "theme.gender_bender",
  "theme.genderswap",
  "theme.harem",
  "theme.loli",
  "theme.monster_girls",
  "theme.reverse_harem",
  "theme.shota",
  "theme.slow_burn_romance",
  "theme.tsundere"
]);

const eroticTagText = new Set([
  "18",
  "18 plus",
  "adult only",
  "bdsm",
  "dirty talk",
  "erotic",
  "erotico",
  "erotica",
  "explicit smut",
  "heavy smut",
  "incest",
  "incesto",
  "non consensual",
  "nonconsensual",
  "nsfw",
  "sex",
  "sex friends",
  "sex slaves",
  "sexual content",
  "smut",
  "threesome",
  "voyeurism"
]);

const suggestiveTagText = new Set([
  "ecchi",
  "fanservice",
  "gender bender",
  "genderbend",
  "genderswap",
  "harem",
  "harem reverso",
  "harém",
  "loli",
  "monster girls",
  "reverse harem",
  "shota",
  "suggestive",
  "sugestivo"
]);

function contentSignals(novel: Pick<Novel, "tags" | "tagKeys">) {
  const keys = tagKeysForNovel(novel);
  const rawTexts = [
    ...keys.map((key) => key.replace(/^(genre|theme|format|raw)\./, "").replace(/[._-]+/g, " ")),
    ...(novel.tags ?? [])
  ].map(normalizeSearchText);
  const hasErotic = keys.some((key) => eroticTagKeys.has(key))
    || rawTexts.some((text) => eroticTagText.has(text));
  const hasSuggestive = keys.some((key) => suggestiveTagKeys.has(key))
    || rawTexts.some((text) => suggestiveTagText.has(text));
  const hasMature = keys.some((key) => matureTagKeys.has(key))
    || rawTexts.some((text) => matureTagText.has(text));
  return { hasErotic, hasSuggestive, hasMature };
}

export function contentRatingForNovel(novel: Pick<Novel, "tags" | "tagKeys">): Exclude<ContentRatingFilter, "all"> {
  const { hasErotic, hasSuggestive, hasMature } = contentSignals(novel);
  if (hasErotic) return "erotic";
  if (hasSuggestive) return "suggestive";
  if (hasMature) return "mature";
  return "safe";
}

export function matchesContentRating(novel: Novel, rating: ContentRatingFilter) {
  if (rating === "all") return true;
  return contentRatingForNovel(novel) === rating;
}

export function cycleTagState(state: TagFilterDraft, key: string): TagFilterDraft {
  if (state.includeTags.includes(key)) {
    return {
      includeTags: state.includeTags.filter((item) => item !== key),
      excludeTags: [...state.excludeTags, key]
    };
  }
  if (state.excludeTags.includes(key)) {
    return {
      includeTags: state.includeTags,
      excludeTags: state.excludeTags.filter((item) => item !== key)
    };
  }
  return {
    includeTags: [...state.includeTags, key],
    excludeTags: state.excludeTags.filter((item) => item !== key)
  };
}

export function buildFallbackTagCatalog(novels: Novel[]): TagCatalogItem[] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  const aliases = new Map<string, Set<string>>();
  for (const novel of novels) {
    const keys = tagKeysForNovel(novel);
    const unique = new Set(keys);
    unique.forEach((key) => counts.set(key, (counts.get(key) ?? 0) + 1));
    novel.tags.forEach((tag, index) => {
      const key = keys[index] ?? rawTagKey(tag);
      if (!labels.has(key)) labels.set(key, tag);
      if (!aliases.has(key)) aliases.set(key, new Set());
      aliases.get(key)?.add(tag);
    });
  }
  return [...counts.entries()]
    .map(([key, count]) => ({
      key,
      label: canonicalForKey(key)?.label ?? labels.get(key) ?? key.replace(/^raw\./, "").replace(/\./g, " "),
      category: canonicalForKey(key)?.category ?? categoryFallback(key),
      aliases: [...(aliases.get(key) ?? [])],
      count,
      reviewStatus: key.startsWith("raw.") ? "unknown" as const : "curated" as const
    }))
    .sort((a, b) => {
      const group = { format: 0, genre: 1, theme: 2 };
      return group[a.category] - group[b.category] || b.count - a.count || a.label.localeCompare(b.label, "pt-BR");
    });
}

export function normalizeTagCatalog(items: TagCatalogItem[]): TagCatalogItem[] {
  const merged = new Map<string, TagCatalogItem>();
  for (const item of items) {
    const key = canonicalizeTagKey(item.key, item.label);
    const canonical = canonicalForKey(key);
    const normalized: TagCatalogItem = {
      ...item,
      key,
      label: canonical?.label ?? item.label,
      category: canonical?.category ?? item.category ?? categoryFallback(key),
      aliases: [...new Set([...(canonical?.aliases ?? []), ...item.aliases])]
    };
    const current = merged.get(key);
    if (!current) {
      merged.set(key, normalized);
    } else {
      current.count += normalized.count;
      current.aliases = [...new Set([...current.aliases, ...normalized.aliases])];
    }
  }
  return [...merged.values()].sort((a, b) => {
    const group = { format: 0, genre: 1, theme: 2 };
    return group[a.category] - group[b.category] || b.count - a.count || a.label.localeCompare(b.label, "pt-BR");
  });
}

export function tagLabel(key: string, catalog: TagCatalogItem[]) {
  return catalog.find((tag) => tag.key === key)?.label ?? key.replace(/^raw\./, "").replace(/\./g, " ");
}

export function tagSearchMatches(tag: TagCatalogItem, query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  const haystack = [tag.label, tag.key, ...tag.aliases].map(normalizeSearchText).join(" ");
  return haystack.includes(normalized);
}
