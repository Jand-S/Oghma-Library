from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Computed,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, TSVECTOR
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class SourceSite(Base):
    __tablename__ = "source_site"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    base_url: Mapped[str] = mapped_column(String(300))
    mode: Mapped[str] = mapped_column(String(32), default="static_html")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    rate_limit_seconds: Mapped[float] = mapped_column(Float, default=2.0)
    novel_count: Mapped[int] = mapped_column(Integer, default=0)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Novel(Base):
    __tablename__ = "novel"

    id: Mapped[str] = mapped_column(String(320), primary_key=True)  # "<source>:<slug>"
    source_id: Mapped[str] = mapped_column(
        ForeignKey("source_site.id", ondelete="CASCADE"), index=True
    )
    slug: Mapped[str] = mapped_column(String(300), index=True)
    title: Mapped[str] = mapped_column(String(500))
    author: Mapped[str | None] = mapped_column(String(300))
    description: Mapped[str | None] = mapped_column(Text)
    cover_url: Mapped[str | None] = mapped_column(String(700))
    cover_path: Mapped[str | None] = mapped_column(String(700))
    language: Mapped[str] = mapped_column(String(16), default="pt-BR")
    status: Mapped[str] = mapped_column(String(16), default="ongoing")
    tags: Mapped[list[str]] = mapped_column(ARRAY(String), default=list)
    tag_keys: Mapped[list[str]] = mapped_column(ARRAY(String), default=list, server_default=text("'{}'::varchar[]"))
    chapter_count: Mapped[int] = mapped_column(Integer, default=0)
    source_url: Mapped[str] = mapped_column(String(700))
    extra: Mapped[dict] = mapped_column(JSONB, default=dict)
    first_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    last_crawled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    search_tsv: Mapped[str | None] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('portuguese', coalesce(title,'') || ' ' || coalesce(author,''))",
            persisted=True,
        ),
    )

    __table_args__ = (
        Index(
            "ix_novel_title_trgm",
            "title",
            postgresql_using="gin",
            postgresql_ops={"title": "gin_trgm_ops"},
        ),
        Index("ix_novel_search_tsv", "search_tsv", postgresql_using="gin"),
        Index("ix_novel_tags", "tags", postgresql_using="gin"),
        Index("ix_novel_tag_keys", "tag_keys", postgresql_using="gin"),
        Index("ix_novel_status", "status"),
        Index("ix_novel_chapter_count", "chapter_count"),
    )


class Chapter(Base):
    __tablename__ = "chapter"

    id: Mapped[str] = mapped_column(String(380), primary_key=True)  # "<novelId>#<number>"
    novel_id: Mapped[str] = mapped_column(
        ForeignKey("novel.id", ondelete="CASCADE"), index=True
    )
    number: Mapped[float] = mapped_column(Numeric(10, 2))
    title: Mapped[str] = mapped_column(String(500))
    source_url: Mapped[str] = mapped_column(String(700))
    published_at: Mapped[str | None] = mapped_column(String(64))
    content_path: Mapped[str | None] = mapped_column(String(700))
    raw_path: Mapped[str | None] = mapped_column(String(700))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    word_count: Mapped[int] = mapped_column(Integer, default=0)
    downloaded: Mapped[bool] = mapped_column(Boolean, default=False)
    fetched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (Index("ix_chapter_novel_number", "novel_id", "number", unique=True),)


class CrawlRun(Base):
    __tablename__ = "crawl_run"

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    source_id: Mapped[str] = mapped_column(ForeignKey("source_site.id"), index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="running")
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
