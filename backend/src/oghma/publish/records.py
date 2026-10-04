from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ChapterRecord:
    id: str
    number: float
    title: str
    published_at: Optional[str]
    word_count: int
    content_path: Optional[str]
    content_hash: Optional[str]


@dataclass
class NovelRecord:
    id: str
    source_id: str
    slug: str
    title: str
    author: Optional[str]
    description: Optional[str]
    cover_path: Optional[str]   # arquivo local (/srv/oghma/covers/...) ou None
    language: str
    status: str
    tags: list[str]
    tag_keys: list[str]
    updated_at: Optional[str]
    extra: dict = field(default_factory=dict)
    # Quando a novel apareceu pela 1a vez e quando ganhou o ultimo capitulo novo (ISO).
    # `updated_at` muda a cada crawl; estes servem para "recem-chegadas" e "atualizadas".
    first_seen_at: Optional[str] = None
    last_new_chapter_at: Optional[str] = None
    chapters: list[ChapterRecord] = field(default_factory=list)
    # Capitulos que o leitor deve saber que faltam: {"number", "title", "reason"}.
    # reason: "empty" | "placeholder" | "rejected" | "http_404" | "gap" (numero pulado na fonte)
    missing: list[dict] = field(default_factory=list)
    # Ids antigos da mesma novel (o site mudou o endereco): o app reconhece livros baixados por eles.
    aliases: list[str] = field(default_factory=list)


@dataclass
class SourceRecord:
    id: str
    name: str
    base_url: str
    novel_count: int
    last_sync: Optional[str]
