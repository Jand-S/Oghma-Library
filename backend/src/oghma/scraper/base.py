"""Contrato executavel de conector. Cada site implementa SiteConnector."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional, Protocol


@dataclass
class NovelRef:
    source_id: str
    slug: str
    url: str


@dataclass
class NovelMeta:
    source_id: str
    slug: str
    title: str
    url: str
    cover_url: Optional[str] = None
    description: Optional[str] = None
    author: Optional[str] = None
    tags: list[str] = field(default_factory=list)
    status: str = "ongoing"
    language: str = "pt-BR"
    source_chapter_count: Optional[int] = None
    extra: dict = field(default_factory=dict)


@dataclass
class ChapterRef:
    number: float
    title: str
    url: str
    published_at: Optional[str] = None


@dataclass
class RawPage:
    url: str
    html: bytes
    etag: Optional[str] = None
    last_modified: Optional[str] = None
    content_type: Optional[str] = None


@dataclass
class NormalizedChapter:
    title: str
    html: str
    text_hash: str
    word_count: int


class Fetcher(Protocol):
    async def get(self, url: str) -> RawPage: ...


class SiteConnector(Protocol):
    id: str
    display_name: str
    base_url: str
    capabilities: set[str]
    rate_limit_seconds: float

    async def discover_novels(self, fetcher: "Fetcher", limit: int | None = None) -> Iterable[NovelRef]: ...
    async def fetch_novel(self, fetcher: "Fetcher", ref: NovelRef) -> NovelMeta: ...
    async def list_chapters(self, fetcher: "Fetcher", novel: NovelMeta) -> list[ChapterRef]: ...
    async def fetch_chapter(self, fetcher: "Fetcher", url: str) -> RawPage: ...
    def normalize_chapter(self, raw: RawPage) -> NormalizedChapter: ...
