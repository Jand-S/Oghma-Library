from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from collections.abc import Iterable

TAXONOMY_VERSION = 1


@dataclass(frozen=True)
class TagDefinition:
    key: str
    label: str
    category: str
    aliases: tuple[str, ...] = ()
    review_status: str = "curated"


def _t(key: str, label: str, category: str, *aliases: str, review_status: str = "curated") -> TagDefinition:
    return TagDefinition(key=key, label=label, category=category, aliases=aliases, review_status=review_status)


TAGS: tuple[TagDefinition, ...] = (
    _t("format.light_novel", "Light Novel", "format", "Lightnovel", "Light-Novel"),
    _t("format.webnovel", "Webnovel", "format", "Web Novel", "Webnovel", "Webnovela"),
    _t("format.original", "Original", "format", "Original Novel"),
    _t("format.one_shot", "One-shot", "format", "One Shot", "Oneshot", "One-shot"),
    _t("format.anthology", "Antologia", "format", "Anthology"),
    _t("format.short_story", "Conto", "format", "Short Story", "Short Stories"),
    _t("format.fan_fiction", "Fan-fiction", "format", "Fan Fiction", "Fanfiction"),
    _t("format.doujinshi", "Doujinshi", "format"),
    _t("format.full_color", "Colorido", "format", "Full Color", "Full Colour", "Colorida"),
    _t("format.long_strip", "Long Strip", "format"),
    _t("format.official_colored", "Colorido Oficial", "format", "Official Colored", "Official Coloured"),
    _t("format.adapted_anime", "Adaptado para Anime", "format", "Adapted to Anime", "Adaptado para um Anime"),
    _t("format.adapted_manga", "Adaptado para Manga", "format", "Adapted to Manga", "Adaptado para um Manga"),
    _t("format.adapted_manhwa", "Adaptado para Manhwa", "format", "Adapted to Manhwa", "Adaptado para um Manhwa"),
    _t("format.adapted_manhua", "Adaptado para Manhua", "format", "Adapted to Manhua", "Adaptado de um Manhua", "Adaptado para um Manhua"),
    _t("format.adapted_movie", "Adaptado para Filme", "format", "Adapted to Movie", "Adaptado para um Filme"),
    _t("format.adapted_game", "Adaptado para Jogo", "format", "Adapted to Game", "Adaptado para um Jogo"),
    _t("format.adapted_drama", "Adaptado para Drama", "format", "Adapted to Drama", "Adaptado para um Drama"),
    _t("format.brazilian", "Brasileira", "format", "Brasil", "Brazilian"),
    _t("format.chinese", "Chinesa", "format", "Chinese", "China"),
    _t("format.korean", "Coreana", "format", "Korean", "Korea"),
    _t("format.japanese", "Japonesa", "format", "Japanese", "Japan"),
    _t("format.american", "Americana", "format", "American"),
    _t("format.angolan", "Angolana", "format", "Angolan"),
    _t("genre.action", "Acao", "genre", "Action", "Ação"),
    _t("genre.adventure", "Aventura", "genre", "Adventure"),
    _t("genre.fantasy", "Fantasia", "genre", "Fantasy"),
    _t("genre.romance", "Romance", "genre"),
    _t("genre.drama", "Drama", "genre"),
    _t("genre.comedy", "Comedia", "genre", "Comedy", "Comédia"),
    _t("genre.mystery", "Misterio", "genre", "Mystery", "Mistério"),
    _t("genre.psychological", "Psicologico", "genre", "Psychological", "Psicológico"),
    _t("genre.horror", "Terror", "genre", "Horror"),
    _t("genre.thriller", "Suspense", "genre", "Thriller"),
    _t("genre.sci_fi", "Ficcao Cientifica", "genre", "Sci-Fi", "Sci-fi", "Sci Fi", "Ficção Científica"),
    _t("genre.tragedy", "Tragedia", "genre", "Tragedy", "Tragédia"),
    _t("genre.slice_of_life", "Cotidiano", "genre", "Slice of Life", "Vida Cotidiana"),
    _t("genre.dark_fantasy", "Fantasia Sombria", "genre", "Dark Fantasy"),
    _t("genre.urban_fantasy", "Fantasia Urbana", "genre", "Urban Fantasy"),
    _t("genre.historical", "Historico", "genre", "Historical", "Histórico"),
    _t("genre.military", "Militar", "genre", "Military"),
    _t("genre.martial_arts", "Artes Marciais", "genre", "Martial Arts"),
    _t("genre.sports", "Esporte", "genre", "Sports"),
    _t("genre.mecha", "Mecha", "genre"),
    _t("genre.medical", "Medico", "genre", "Medical", "Médico"),
    _t("genre.crime", "Crime", "genre"),
    _t("genre.philosophical", "Filosofico", "genre", "Philosophical", "Filosófico"),
    _t("genre.superhero", "Super-heroi", "genre", "Superhero", "Super Hero"),
    _t("genre.magical_girls", "Garotas Magicas", "genre", "Magical Girls", "Mahou Shoujo"),
    _t("genre.isekai", "Isekai", "genre"),
    _t("genre.wuxia", "Wuxia", "genre"),
    _t("genre.xianxia", "Xianxia", "genre"),
    _t("genre.xuanhuan", "Xuanhuan", "genre"),
    _t("genre.cultivation", "Cultivo", "genre", "Cultivation"),
    _t("genre.shounen", "Shounen", "genre", "Shonen"),
    _t("genre.shoujo", "Shoujo", "genre", "Shojo"),
    _t("genre.seinen", "Seinen", "genre"),
    _t("genre.josei", "Josei", "genre"),
    _t("genre.boys_love", "Boys Love", "genre", "BL", "Yaoi"),
    _t("genre.girls_love", "Girls Love", "genre", "GL", "Yuri"),
    _t("genre.adult", "Adulto", "genre", "Adult", "Mature", "18+", "+18", "Publico Adulto", "Público Adulto"),
    _t("genre.ecchi", "Ecchi", "genre"),
    _t("genre.erotic", "Erotico", "genre", "Smut", "Erótico"),
    _t("genre.explicit_erotic", "Erotico Explicito", "genre", "Heavy Smut", "Explicit Smut", "Erótico Explícito"),
    _t("genre.supernatural", "Sobrenatural", "genre", "Supernatural"),
    _t("theme.male_protagonist", "Protagonista Masculino", "theme", "Male Protagonist"),
    _t("theme.female_protagonist", "Protagonista Feminina", "theme", "Female Protagonist"),
    _t("theme.character_growth", "Crescimento do Personagem", "theme", "Character Growth"),
    _t("theme.clever_protagonist", "Protagonista Inteligente", "theme", "Clever Protagonist", "Smart Protagonist"),
    _t("theme.cunning_protagonist", "Protagonista Astuto", "theme", "Cunning Protagonist"),
    _t("theme.overpowered_protagonist", "Protagonista Super Poderoso", "theme", "Overpowered Protagonist", "OP Protagonist"),
    _t("theme.evil_protagonist", "Protagonista Maligno", "theme", "Evil Protagonist"),
    _t("theme.magic", "Magia", "theme", "Magic", "Magica", "Mágica"),
    _t("theme.black_magic", "Magia Negra", "theme", "Black Magic"),
    _t("theme.harem", "Harem", "theme", "Harém"),
    _t("theme.reverse_harem", "Harem Reverso", "theme", "Reverse Harem", "Harém Reverso"),
    _t("theme.aristocracy", "Aristocracia", "theme", "Aristocracy"),
    _t("theme.knights", "Cavaleiros", "theme", "Knights"),
    _t("theme.level_system", "Sistema de Nivel", "theme", "Level System", "Sistema de Nível"),
    _t("theme.system", "Sistema", "theme", "System"),
    _t("theme.doting_love_interests", "Interesses Amorosos Carinhosos", "theme", "Doting Love Interests"),
    _t("theme.devoted_love_interests", "Interesses Amorosos Devotados", "theme", "Devoted Love Interests"),
    _t("theme.nobles", "Nobres", "theme", "Nobles", "Nobreza"),
    _t("theme.transported_world", "Transportado para Outro Mundo", "theme", "Transported to Another World"),
    _t("theme.demons", "Demonios", "theme", "Demons", "Demônios"),
    _t("theme.guilds", "Guildas", "theme", "Guilds"),
    _t("theme.schemes_conspiracies", "Esquemas e Conspiracoes", "theme", "Schemes And Conspiracies", "Conspiracies"),
    _t("theme.dungeons", "Calaboucos", "theme", "Dungeons", "Calabouços"),
    _t("theme.politics", "Politica", "theme", "Politics", "Política"),
    _t("theme.reincarnation", "Reencarnacao", "theme", "Reincarnation", "Reencarnação"),
    _t("theme.modern_day", "Dias Modernos", "theme", "Modern Day"),
    _t("theme.wizards", "Magos", "theme", "Wizards"),
    _t("theme.academy", "Academia", "theme", "Academy"),
    _t("theme.awakening", "Despertar", "theme", "Awakening"),
    _t("theme.skills", "Habilidades", "theme", "Skills"),
    _t("theme.age_regression", "Regressao de Idade", "theme", "Age Regression", "Regressão de Idade"),
    _t("theme.forbidden_relationships", "Relacionamentos Proibidos", "theme", "Forbidden Relationships"),
    _t("theme.second_chance", "Segunda Chance", "theme", "Second Chance"),
    _t("theme.assassins", "Assassinos", "theme", "Assassins"),
    _t("theme.european_ambience", "Ambientacao Europeia", "theme", "European Ambience", "Ambientação Europeia"),
    _t("theme.kingdoms", "Reinos", "theme", "Kingdoms"),
    _t("theme.monster_girls", "Garotas Monstro", "theme", "Monster Girls"),
    _t("theme.redemption", "Redencao", "theme", "Redemption", "Redenção"),
    _t("theme.sword_wielder", "Portador de Espada", "theme", "Sword Wielder"),
    _t("theme.blackmail", "Chantagem", "theme", "Blackmail"),
    _t("theme.demon_lord", "Lorde Demonio", "theme", "Demon Lord", "Lorde Demônio"),
    _t("theme.obsessive_love", "Amor Obsessivo", "theme", "Obsessive Love"),
    _t("theme.apocalypse", "Apocalipse", "theme", "Apocalypse"),
    _t("theme.post_apocalyptic", "Pos-apocaliptico", "theme", "Post-Apocalyptic", "Pós-apocalíptico"),
    _t("theme.kingdom_building", "Construcao de Reino", "theme", "Kingdom Building", "Construção de Reino"),
    _t("theme.gods", "Deuses", "theme", "Gods"),
    _t("theme.love_interest_first", "Interesse Amoroso se Apaixona Primeiro", "theme", "Love Interest Falls in Love First"),
    _t("theme.mercenaries", "Mercenarios", "theme", "Mercenaries", "Mercenários"),
    _t("theme.misunderstandings", "Mal-entendidos", "theme", "Misunderstandings"),
    _t("theme.revenge", "Vinganca", "theme", "Revenge", "Vingança"),
    _t("theme.sex_friends", "Amizade Colorida", "theme", "Sex Friends", "Friends With Benefits"),
    _t("theme.threesome", "Sexo a Tres", "theme", "Threesome", "Sexo a Três"),
    _t("theme.dark", "Sombrio", "theme", "Dark"),
    _t("theme.nonconsensual", "Nao Consensual", "theme", "Nonconsensual", "Non-consensual", "Não Consensual"),
    _t("theme.possession", "Possessao", "theme", "Possession", "Possessão"),
    _t("theme.pure_love", "Amor Puro", "theme", "Pure Love"),
    _t("theme.spirits", "Espiritos", "theme", "Spirits", "Espíritos"),
    _t("theme.survival", "Sobrevivencia", "theme", "Survival", "Sobrevivência"),
    _t("theme.wars", "Guerras", "theme", "Wars"),
    _t("theme.angels", "Anjos", "theme", "Angels"),
    _t("theme.business_management", "Administracao de Negocios", "theme", "Business Management", "Administração de Negócios"),
    _t("theme.constellation", "Constelacao", "theme", "Constellation", "Constelação"),
    _t("theme.demi_humans", "Demi-Humanos", "theme", "Demi Humans", "Demi-Humans"),
    _t("theme.detectives", "Detetives", "theme", "Detectives"),
    _t("theme.dirty_talk", "Linguagem Explicita", "theme", "Dirty Talk", "Linguagem Explícita"),
    _t("theme.forced_marriage", "Casamento Forcado", "theme", "Forced Marriage", "Casamento Forçado"),
    _t("theme.spies", "Espioes", "theme", "Spies", "Espiões"),
    _t("theme.tragic_past", "Passado Tragico", "theme", "Tragic Past", "Passado Trágico"),
    _t("theme.voyeurism", "Voyeurismo", "theme", "Voyeurism"),
    _t("theme.arranged_marriage", "Casamento Arranjado", "theme", "Arranged Marriage"),
    _t("theme.blacksmith", "Ferreiro", "theme", "Blacksmith"),
    _t("theme.daughter_in_law", "Nora", "theme", "Daughter-In-Law", "Daughter in Law"),
    _t("theme.dominance", "Dominacao", "theme", "Dominance", "Dominação"),
    _t("theme.dragon_slayers", "Cacadores de Dragoes", "theme", "Dragon Slayers", "Caçadores de Dragões"),
    _t("theme.dragons", "Dragoes", "theme", "Dragons", "Dragões"),
    _t("theme.empires", "Imperios", "theme", "Empires", "Impérios"),
    _t("theme.evil_gods", "Deuses Malignos", "theme", "Evil Gods"),
    _t("theme.father_in_law", "Sogro", "theme", "Father-In-Law", "Father in Law"),
    _t("theme.game_elements", "Elementos de Jogos", "theme", "Game Elements"),
    _t("theme.language_barrier", "Barreira Linguistica", "theme", "Language Barrier", "Barreira Linguística"),
    _t("theme.lawyers", "Advogados", "theme", "Lawyers"),
    _t("theme.love", "Amor", "theme", "Love"),
    _t("theme.male_to_female", "Masculino para Feminino", "theme", "Male to Female"),
    _t("theme.necromancer", "Necromante", "theme", "Necromancer"),
    _t("theme.ninjas", "Ninjas", "theme"),
    _t("theme.school_life", "Vida Escolar", "theme", "School Life", "Escolar"),
    _t("theme.sex_slaves", "Escravidao Sexual", "theme", "Sex Slaves", "Escravidão Sexual"),
    _t("theme.slow_burn_romance", "Romance de Desenvolvimento Lento", "theme", "Slow Burn Romance"),
    _t("theme.survival_game", "Jogo de Sobrevivencia", "theme", "Survival Game", "Jogo de Sobrevivência"),
    _t("theme.transmigration", "Transmigracao", "theme", "Transmigration", "Transmigração"),
    _t("theme.weak_to_strong", "Fraco a Forte", "theme", "Weak To Strong", "Weak to Strong"),
    _t("theme.zombies", "Zumbis", "theme", "Zombies"),
    _t("theme.vampires", "Vampiros", "theme", "Vampires"),
    _t("theme.aliens", "Alienigenas", "theme", "Aliens", "Alienígenas"),
    _t("theme.animals", "Animais", "theme", "Animals"),
    _t("theme.cooking", "Culinaria", "theme", "Cooking", "Culinária"),
    _t("theme.cross_dressing", "Cross-dressing", "theme", "Crossdressing", "Cross Dressing"),
    _t("theme.delinquents", "Delinquentes", "theme", "Delinquents"),
    _t("theme.genderswap", "Troca de Genero", "theme", "Genderswap", "Gender Swap", "Troca de Gênero"),
    _t("theme.ghosts", "Fantasmas", "theme", "Ghosts"),
    _t("theme.gyaru", "Gyaru", "theme"),
    _t("theme.incest", "Incesto", "theme", "Incest"),
    _t("theme.loli", "Loli", "theme"),
    _t("theme.mafia", "Mafia", "theme", "Máfia"),
    _t("theme.mahjong", "Mahjong", "theme"),
    _t("theme.monsters", "Monstros", "theme", "Monsters"),
    _t("theme.music", "Musica", "theme", "Music", "Música"),
    _t("theme.office_workers", "Trabalhadores de Escritorio", "theme", "Office Workers", "Trabalhadores de Escritório"),
    _t("theme.police", "Policia", "theme", "Police", "Polícia"),
    _t("theme.samurai", "Samurai", "theme"),
    _t("theme.shota", "Shota", "theme"),
    _t("theme.time_travel", "Viagem no Tempo", "theme", "Time Travel"),
    _t("theme.traditional_games", "Jogos Tradicionais", "theme", "Traditional Games"),
    _t("theme.video_games", "Video Games", "theme", "Video Game", "Videogame"),
    _t("theme.villainess", "Vilã", "theme", "Villainess", "Vilã", "Vilã(o)", "Vilao", "Vilão"),
    _t("theme.virtual_reality", "Realidade Virtual", "theme", "Virtual Reality"),
    _t("theme.bdsm", "BDSM", "theme", "BDSM"),
    _t("theme.buff", "Buff", "theme", "Buff"),
    _t("theme.face_slapping", "Face Slapping", "theme", "Face-slapping"),
    _t("theme.fusion_fantasy", "Fusion Fantasy", "theme"),
    _t("theme.gacha", "Gacha", "theme"),
    _t("theme.gender_bender", "Gender Bender", "theme"),
    _t("theme.jack_of_all_trades", "Jack of All Trades", "theme"),
    _t("theme.litrpg", "LitRPG", "theme", "Lit RPG"),
    _t("theme.milf", "MILF", "theme"),
    _t("theme.dilf", "DILF", "theme"),
    _t("theme.tsundere", "Tsundere", "theme"),
)


def _normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = " ".join(value.replace("_", " ").split())
    decomposed = unicodedata.normalize("NFD", value.casefold())
    value = "".join(ch for ch in decomposed if unicodedata.category(ch) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _slug(value: str) -> str:
    normalized = _normalize_text(value)
    return re.sub(r"[^a-z0-9]+", ".", normalized).strip(".") or "unknown"


_LOOKUP: dict[str, TagDefinition] = {}
_BY_KEY: dict[str, TagDefinition] = {tag.key: tag for tag in TAGS}
for _tag in TAGS:
    for _alias in (_tag.label, *_tag.aliases):
        _LOOKUP[_normalize_text(_alias)] = _tag


def lookup_tag(raw: str) -> TagDefinition | None:
    return _LOOKUP.get(_normalize_text(raw))


def normalize_tag_key(raw: str) -> str:
    found = lookup_tag(raw)
    if found:
        return found.key
    return f"raw.{_slug(raw)}"


def canonical_tag_keys(raw_tags: Iterable[str]) -> list[str]:
    keys: list[str] = []
    seen: set[str] = set()
    for raw in raw_tags:
        if not raw or not str(raw).strip():
            continue
        key = normalize_tag_key(str(raw))
        if key in seen:
            continue
        seen.add(key)
        keys.append(key)
    return keys


def _label_for_unknown(key: str, raw_labels: Iterable[str] = ()) -> str:
    for raw in raw_labels:
        if normalize_tag_key(raw) == key:
            return " ".join(str(raw).split())
    return key.removeprefix("raw.").replace(".", " ").title()


def build_tag_items(
    counts: dict[str, int] | None = None,
    raw_labels: dict[str, set[str]] | None = None,
) -> list[dict]:
    counts = counts or {}
    raw_labels = raw_labels or {}
    keys = set(counts)
    items: list[dict] = []
    for key in keys:
        tag = _BY_KEY.get(key)
        if tag is None:
            labels = sorted(raw_labels.get(key, ()), key=lambda value: (len(value), value.casefold()))
            items.append(
                {
                    "key": key,
                    "label": _label_for_unknown(key, labels),
                    "category": "theme",
                    "aliases": labels[:8],
                    "count": int(counts.get(key, 0)),
                    "reviewStatus": "unknown",
                }
            )
            continue
        items.append(
            {
                "key": tag.key,
                "label": tag.label,
                "category": tag.category,
                "aliases": list(tag.aliases),
                "count": int(counts.get(tag.key, 0)),
                "reviewStatus": tag.review_status,
            }
        )
    return sorted(
        items,
        key=lambda item: (
            {"format": 0, "genre": 1, "theme": 2}.get(str(item["category"]), 9),
            -int(item.get("count") or 0),
            str(item["label"]).casefold(),
        ),
    )
