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
    chapters: list[ChapterRecord] = field(default_factory=list)


@dataclass
class SourceRecord:
    id: str
    name: str
    base_url: str
    novel_count: int
    last_sync: Optional[str]
