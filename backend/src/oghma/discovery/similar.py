"""Parecidos pre-calculados: o app mostra a lista pronta, sem gastar a IA de quem usa.

Cada obra vira um texto (a ficha da historia, quando existe; senao titulo + tags + sinopse),
o texto vira um vetor num modelo de embeddings multilingue que roda na CPU da VPS
(fastembed/ONNX), e a nota de cada par combina o cosseno dos vetores com as tags de historia
em comum. Vetores ficam em cache pelo hash do texto: so obras novas ou alteradas sao
recalculadas.

Tambem sai daqui a lista de edicoes da mesma obra em outras fontes que o titulo nao pega
(traducao com outro nome: "Classroom of the Elite" = "A Classe de Elite"): sinopses quase
identicas no espaco multilingue, ou o titulo traduzido com mais um sinal (o autor, a sinopse
parecida) e um numero de capitulos compativel ("Advent of the Three Calamities" =
"Advento das Tres Calamidades", mesmo autor escrito "Entrail_JI" e "Entrail_Jl, Gehrman").
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from dataclasses import dataclass, field
from html import unescape
from pathlib import Path
from typing import Iterable, Optional

# mpnet separou melhor as historias no piloto das fichas que o MiniLM. A versao completa (fp32)
# passa de 2 GB de RAM na VPS; a quantizada int8 que o Xenova publica fica perto de 1 GB e
# concorda em 93% do top 6 com ela. OGHMA_DISCOVERY_MODEL troca sem mexer no codigo.
MPNET_Q8 = "oghma/paraphrase-multilingual-mpnet-base-v2-q8"
MODEL = os.environ.get("OGHMA_DISCOVERY_MODEL", MPNET_Q8)


def _register_custom_models() -> None:
    from fastembed import TextEmbedding
    from fastembed.common.model_description import ModelSource, PoolingType

    if any(m["model"] == MPNET_Q8 for m in TextEmbedding.list_supported_models()):
        return
    TextEmbedding.add_custom_model(
        model=MPNET_Q8, pooling=PoolingType.MEAN, normalization=True, dim=768,
        sources=ModelSource(hf="Xenova/paraphrase-multilingual-mpnet-base-v2"), model_file="onnx/model_quantized.onnx")
TOP_K = 24
# Peso do cosseno dos textos e das tags de historia (Jaccard) na nota do par.
# 0,2: com fichas, tags genericas (acao, fantasia, magia, sistema) puxavam obras comuns; com 0,35
# Shadow Slave perdia Book of the Dead e Second Coming of Gluttony para fantasias genericas.
TAG_WEIGHT = float(os.environ.get("OGHMA_DISCOVERY_TAG_WEIGHT", "0.2"))
TEXT_WEIGHT = 1.0 - TAG_WEIGHT
# Sinopses tao proximas assim sao a mesma obra (outra traducao/edicao), nao uma parecida.
SAME_WORK_COSINE = 0.9
# Titulo traduzido. So o titulo junta obras diferentes ("The World After the Bad Ending" e
# "The World After the End" dao 0,90), entao sempre vem com outro sinal: o mesmo autor e a
# sinopse no mesmo assunto, ou um titulo quase identico e a sinopse parecida. Calibrado no
# catalogo de 05/10/2026: 17 pares novos, nenhum errado.
SAME_TITLE_WITH_AUTHOR = 0.85
SAME_TITLE_WITH_SYNOPSIS = 0.9
SAME_SYNOPSIS_WITH_TITLE = 0.6
SAME_TOPIC_WITH_AUTHOR = 0.45
# Mesmo autor e titulos so proximos ("A Will Eternal" e "Uma Vontade Eterna") pedem a sinopse
# bem parecida: o mesmo autor escreve outras obras de nome parecido.
SAME_AUTHOR_TITLE = 0.7
SAME_AUTHOR_SYNOPSIS = 0.7
# Edicoes da mesma obra tem contagens de capitulos parecidas; uma traducao parcial bem
# menor fica de fora (o titulo pode ser so parecido).
CHAPTER_RATIO = 0.6
# Com o titulo como sinal, uma sinopse curta (as da Rolia Scan tem ~170 caracteres) ja serve
# para confirmar; sozinha, a sinopse precisa de corpo (`_real_text`).
SHORT_SYNOPSIS_CHARS = 100
SYNOPSIS_CHARS = 1500
# Lotes pequenos: a memoria do modelo cresce com o lote (com 32 textos o mpnet passou de 2,4 GB
# na VPS de 3,8 GB). Com 4 fica perto de 1 GB, mais lento, sem apertar o rodizio e o Postgres.
BATCH_SIZE = int(os.environ.get("OGHMA_DISCOVERY_BATCH", "4"))
THREADS = int(os.environ.get("OGHMA_DISCOVERY_THREADS", "1"))


@dataclass
class DiscoveryNovel:
    id: str
    source_id: str
    title: str
    language: str
    description: Optional[str]
    tags: list[str] = field(default_factory=list)
    tag_keys: list[str] = field(default_factory=list)
    author: Optional[str] = None
    chapters: int = 0


def work_key(title: str) -> str:
    """Igual ao `workKey` do app: titulo sem acento, caixa e sufixos como "(Novel)" ou "[WN]"."""
    text = re.sub(r"[(\[][^)\]]*[)\]]", " ", title or "")
    text = unicodedata.normalize("NFD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def author_names(author: Optional[str]) -> frozenset[str]:
    """Nomes do campo de autor, comparaveis entre fontes: sem acento, caixa e simbolos, cada
    nome em separado ("耳根, Er Gen" tem "ergen") e com I e l iguais ("Entrail_JI" e
    "Entrail_Jl" sao o mesmo). Nomes curtos ou so em outro alfabeto ficam de fora."""
    text = unicodedata.normalize("NFD", (author or "").lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    names = {re.sub(r"[^a-z0-9]", "", part.replace("l", "i")) for part in re.split(r"[,/&;]| e | and ", text)}
    return frozenset(name for name in names if len(name) >= 4)


def _chapters_close(a: int, b: int) -> bool:
    return a > 0 and b > 0 and min(a, b) / max(a, b) >= CHAPTER_RATIO


def series_key(title: str) -> str:
    """Nome da serie antes de ":" ou " - " ("Mushoku Tensei: Jobless Reincarnation" e
    "Mushoku Tensei: Reencarnacao do Desempregado"), quando ele e longo o bastante para nao
    juntar obras por acaso ("Re:Zero" fica de fora). Vazio quando nao ha serie."""
    head = re.split(r"\s*[:–—]\s*|\s+-\s+", title or "", maxsplit=1)
    if len(head) < 2:
        return ""
    key = work_key(head[0])
    return key if len(key) >= 8 and " " in key else ""


def _plain(text: Optional[str]) -> str:
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", text or ""))).strip()


def ficha_text(ficha: dict) -> str:
    """So o conteudo da ficha: rotulos fixos ("Protagonista:", "Premissa:") se repetem em toda
    ficha e aproximavam obras que nao tem nada a ver."""
    parts = [ficha.get(k) for k in ("premissa", "protagonista", "mundo", "tom", "estrutura")]
    parts += [t for t in ficha.get("tracos") or [] if isinstance(t, str)]
    return " ".join(p.strip() for p in parts if isinstance(p, str) and p.strip())


def novel_text(novel: DiscoveryNovel, ficha: Optional[dict] = None) -> str:
    """Texto que representa a historia: a ficha quando existe (padronizada, compara historias),
    senao a sinopse limpa (ou o titulo, sem sinopse)."""
    if ficha:
        return ficha_text(ficha)
    return _plain(novel.description)[:SYNOPSIS_CHARS] or novel.title


def synopsis_text(novel: DiscoveryNovel) -> str:
    return _plain(novel.description)[:SYNOPSIS_CHARS] or novel.title


def story_tags(keys: Iterable[str]) -> set[str]:
    return {k for k in keys if not k.startswith("format.")}


def text_hash(model: str, text: str) -> str:
    return hashlib.sha1(f"{model}\n{text}".encode("utf-8")).hexdigest()


class EmbeddingCache:
    """Vetores ja calculados, pelo hash (modelo + texto), num .npz ao lado de um indice json."""

    def __init__(self, directory: Path):
        self.dir = directory
        self.vectors: dict[str, "list[float]"] = {}

    def load(self) -> None:
        import numpy as np

        path = self.dir / "embeddings.npz"
        if path.exists():
            data = np.load(path)
            self.vectors = {key: data[key] for key in data.files}

    def save(self, keep: set[str]) -> None:
        import numpy as np

        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = self.dir / "embeddings.tmp.npz"
        np.savez_compressed(tmp, **{k: v for k, v in self.vectors.items() if k in keep})
        tmp.replace(self.dir / "embeddings.npz")


def embed(texts: list[str], model: str = MODEL, cache: Optional[EmbeddingCache] = None, embedder=None,
          models_dir: Optional[Path] = None):
    """Matriz (n, d) normalizada e as chaves usadas. Com cache, so os textos novos passam pelo
    modelo (e o modelo nem e carregado quando nada mudou)."""
    import numpy as np

    store = cache.vectors if cache is not None else {}
    keys = [text_hash(model, t) for t in texts]
    missing = [i for i, k in enumerate(keys) if k not in store]
    if missing:
        if embedder is None:
            from fastembed import TextEmbedding

            _register_custom_models()
            # Fora de /tmp: o modelo (~220 MB) nao precisa ser baixado de novo apos um reboot.
            embedder = TextEmbedding(model_name=model, cache_dir=str(models_dir) if models_dir else None, threads=THREADS)
        for i, vec in zip(missing, embedder.embed([texts[i] for i in missing], batch_size=BATCH_SIZE)):
            vec = np.asarray(vec, dtype=np.float32)
            store[keys[i]] = vec / (np.linalg.norm(vec) or 1.0)
    return np.stack([store[k] for k in keys]), set(keys)


def _same_work(i: int, j: int, novels: list[DiscoveryNovel], keys: list[str], authors: list[frozenset[str]],
               same_text, same_title) -> bool:
    """Duas obras de fontes diferentes sao edicoes da mesma (ver as constantes acima)."""
    a, b = novels[i], novels[j]
    if a.source_id == b.source_id:
        return False
    if keys[i] == keys[j]:
        return True
    if same_text[i, j] >= SAME_WORK_COSINE and _real_text(a) and _real_text(b):
        return True
    if same_title is None:
        return False
    title, text = float(same_title[i, j]), float(same_text[i, j])
    author = bool(authors[i] & authors[j])
    chapters = _chapters_close(a.chapters, b.chapters)
    if chapters and author and title >= SAME_TITLE_WITH_AUTHOR and text >= SAME_TOPIC_WITH_AUTHOR:
        return True
    some_text = _text_length(a) >= SHORT_SYNOPSIS_CHARS and _text_length(b) >= SHORT_SYNOPSIS_CHARS
    if chapters and some_text and title >= SAME_TITLE_WITH_SYNOPSIS and text >= SAME_SYNOPSIS_WITH_TITLE:
        return True
    return author and some_text and title >= SAME_AUTHOR_TITLE and text >= SAME_AUTHOR_SYNOPSIS


def build_discovery(novels: list[DiscoveryNovel], story_vecs, synopsis_vecs, top_k: int = TOP_K, title_vecs=None) -> dict:
    """Parecidos (top_k por obra, sem a propria obra nem outras edicoes dela) e edicoes da
    mesma obra entre idiomas. `story_vecs` compara historias (ficha ou sinopse);
    `synopsis_vecs` e `title_vecs` (opcional) so servem para reconhecer a mesma obra traduzida."""
    import numpy as np

    n = len(novels)
    keys = [work_key(x.title) for x in novels]
    series = [series_key(x.title) for x in novels]
    tags = [story_tags(x.tag_keys) for x in novels]
    authors = [author_names(x.author) for x in novels]
    same_text = synopsis_vecs @ synopsis_vecs.T
    same_title = title_vecs @ title_vecs.T if title_vecs is not None else None
    editions: dict[str, list[str]] = {}
    for i in range(n):
        others = [j for j in range(n) if j != i and _same_work(i, j, novels, keys, authors, same_text, same_title)]
        if others:
            editions[novels[i].id] = [novels[j].id for j in others]
    story = story_vecs @ story_vecs.T
    similar: dict[str, list[list]] = {}
    for i in range(n):
        same = {i} | {j for j in range(n) if keys[j] == keys[i] or (series[i] and series[i] in (series[j], keys[j]))
                      or (series[j] and series[j] == keys[i])} | {
            j for j in range(n) if novels[j].id in set(editions.get(novels[i].id, []))}
        jac = np.array([len(t & tags[i]) / (len(t | tags[i]) or 1) for t in tags], dtype=np.float32)
        score = TEXT_WEIGHT * story[i] + TAG_WEIGHT * jac
        out: list[list] = []
        seen_works: set[str] = set()
        for j in np.argsort(-score):
            j = int(j)
            if j in same or keys[j] in seen_works:
                continue
            seen_works.add(keys[j])
            out.append([novels[j].id, round(float(score[j]), 3)])
            if len(out) >= top_k:
                break
        similar[novels[i].id] = out
    return {"similar": similar, "editions": editions}


def _text_length(novel: DiscoveryNovel) -> int:
    return len(_plain(novel.description))


def _real_text(novel: DiscoveryNovel) -> bool:
    """Sinopse com corpo suficiente para reconhecer a mesma obra (curtas demais casam por acaso)."""
    return len(_plain(novel.description)) >= 200


def load_fichas(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    return {k: v for k, v in data.items() if isinstance(v, dict)}
