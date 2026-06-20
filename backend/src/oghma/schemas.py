"""DTOs de saida da API, ja no formato camelCase que o desktop espera.

A traducao 'DTO real -> tipo da UI' fica concentrada aqui + no httpBackendClient
do desktop, para a UI (appUi.tsx) nao precisar mudar.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict


def to_camel(s: str) -> str:
    head, *tail = s.split("_")
    return head + "".join(w.capitalize() for w in tail)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, from_attributes=True)


class SourceOut(ApiModel):
    id: str
    name: str
    base_url: str
    count: int = 0
    status: str = "online"
    enabled: bool = True
    mode: str = "static_html"
    last_sync: str = ""
    delay_ms: int = 0


class NovelOut(ApiModel):
    id: str
    title: str
    author: str = ""
    source_id: str
    source_name: str = ""
    tags: list[str] = []
    tag_keys: list[str] = []
    status: str = "ongoing"
    chapters: int = 0
    language: str = "pt-BR"
    updated_at: str = ""
    description: str = ""
    cover_url: str | None = None  # backend real manda URL; UI passa a aceitar imagem


class ChapterOut(ApiModel):
    id: str
    novel_id: str
    number: float
    title: str
    downloaded: bool = False
    word_count: int = 0


class ChapterPage(ApiModel):
    items: list[ChapterOut]
    page: int
    page_size: int
    total: int


class CrawlRunOut(ApiModel):
    id: int
    source_id: str
    status: str
    stats: dict = {}
    error: str = ""
    started_at: str = ""
    finished_at: str = ""


class TagOut(ApiModel):
    key: str
    label: str
    category: str
    aliases: list[str] = []
    count: int = 0
    review_status: str = "curated"


class TagCatalogOut(ApiModel):
    taxonomy_version: int
    items: list[TagOut] = []


class BootstrapOut(ApiModel):
    sources: list[SourceOut] = []
    novels: list[NovelOut] = []
    queue: list = []
    library: list = []
