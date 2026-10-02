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
    # ok | invalid (vazio ou placeholder; tenta de novo) | duplicate (mesmo texto de outro capitulo)
    status: Mapped[str] = mapped_column(String(16), default="ok", server_default="ok")
    problem: Mapped[str | None] = mapped_column(String(32))

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


class TranslationJobRow(Base):
    __tablename__ = "translation_job"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    novel_id: Mapped[str] = mapped_column(String(320), index=True)
    chapter_from: Mapped[float] = mapped_column(Numeric(10, 2))
    chapter_to: Mapped[float] = mapped_column(Numeric(10, 2))
    target_language: Mapped[str] = mapped_column(String(16), default="pt-BR")
    mode: Mapped[str] = mapped_column(String(32), default="balanced")
    strategy: Mapped[str] = mapped_column(String(32), default="manual")
    status: Mapped[str] = mapped_column(String(32), index=True, default="queued")
    selected_model: Mapped[str] = mapped_column(String(160), default="")
    provider: Mapped[str] = mapped_column(String(64), default="")
    worker_count: Mapped[int] = mapped_column(Integer, default=1)
    reuse_existing: Mapped[bool] = mapped_column(Boolean, default=True)
    max_cost_usd: Mapped[float | None] = mapped_column(Float)
    stats: Mapped[dict] = mapped_column(JSONB, default=dict)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("ix_translation_job_novel_status", "novel_id", "status"),
        Index("ix_translation_job_created_at", "created_at"),
    )


class TranslationChapterRow(Base):
    __tablename__ = "translation_chapter"

    id: Mapped[str] = mapped_column(String(420), primary_key=True)
    novel_id: Mapped[str] = mapped_column(String(320), index=True)
    chapter_id: Mapped[str] = mapped_column(String(380), index=True, default="")
    chapter_number: Mapped[float] = mapped_column(Numeric(10, 2))
    target_language: Mapped[str] = mapped_column(String(16), default="pt-BR")
    status: Mapped[str] = mapped_column(String(32), index=True, default="approved_auto")
    translated_path: Mapped[str] = mapped_column(String(900), default="")
    sidecar_path: Mapped[str] = mapped_column(String(900), default="")
    source_hash: Mapped[str | None] = mapped_column(String(64))
    translated_hash: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str] = mapped_column(String(160), default="")
    provider: Mapped[str] = mapped_column(String(64), default="")
    quality_score: Mapped[float | None] = mapped_column(Float)
    public_reusable: Mapped[bool] = mapped_column(Boolean, default=True)
    origin: Mapped[str] = mapped_column(String(32), default="local")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_translation_chapter_lookup", "novel_id", "chapter_number", "target_language", unique=True),
        Index("ix_translation_chapter_reusable", "novel_id", "target_language", "public_reusable"),
    )


class TranslationMemoryTermRow(Base):
    __tablename__ = "translation_memory_term"

    id: Mapped[str] = mapped_column(String(420), primary_key=True)
    novel_id: Mapped[str] = mapped_column(String(320), index=True)
    source: Mapped[str] = mapped_column(String(300))
    target: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(32), default="candidate")
    category: Mapped[str] = mapped_column(String(64), default="")
    occurrences: Mapped[int] = mapped_column(Integer, default=0)
    first_chapter: Mapped[float | None] = mapped_column(Numeric(10, 2))
    last_chapter: Mapped[float | None] = mapped_column(Numeric(10, 2))
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    notes: Mapped[str] = mapped_column(Text, default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_translation_memory_term_unique", "novel_id", "source", unique=True),
        Index("ix_translation_memory_term_status", "novel_id", "status"),
    )


class TranslationSelectionHistoryRow(Base):
    __tablename__ = "translation_selection_history"

    id: Mapped[str] = mapped_column(String(260), primary_key=True)
    job_id: Mapped[str] = mapped_column(String(64), index=True)
    novel_id: Mapped[str] = mapped_column(String(320), index=True)
    chapter_from: Mapped[float] = mapped_column(Numeric(10, 2))
    chapter_to: Mapped[float] = mapped_column(Numeric(10, 2))
    target_language: Mapped[str] = mapped_column(String(16), default="pt-BR")
    mode: Mapped[str] = mapped_column(String(32), default="balanced")
    winner_model: Mapped[str] = mapped_column(String(160), index=True)
    winner_provider: Mapped[str] = mapped_column(String(64), default="")
    editorial_grade_count: Mapped[int] = mapped_column(Integer, default=0)
    editorial_cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    sample_chapters: Mapped[list] = mapped_column(JSONB, default=list)
    trials: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (Index("ix_translation_selection_novel_created", "novel_id", "created_at"),)


class TranslationPricingSnapshotRow(Base):
    __tablename__ = "translation_pricing_snapshot"

    id: Mapped[str] = mapped_column(String(260), primary_key=True)
    provider: Mapped[str] = mapped_column(String(64), index=True)
    model: Mapped[str] = mapped_column(String(160), index=True)
    input_usd_per_1m: Mapped[float] = mapped_column(Float)
    cached_input_usd_per_1m: Mapped[float] = mapped_column(Float)
    output_usd_per_1m: Mapped[float] = mapped_column(Float)
    source_url: Mapped[str] = mapped_column(String(700), default="")
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    __table_args__ = (Index("ix_translation_pricing_provider_model", "provider", "model", unique=True),)
