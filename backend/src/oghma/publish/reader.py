"""Le novels/capitulos do Postgres e converte em records (async)."""
from __future__ import annotations

from .records import ChapterRecord, NovelRecord, SourceRecord


async def read_source(session, source_id: str) -> tuple[SourceRecord, list[NovelRecord]]:
    from sqlalchemy import select  # import tardio (so no servidor)

    from ..models import Chapter, Novel, SourceSite

    src = await session.get(SourceSite, source_id)
    source = SourceRecord(
        id=source_id,
        name=(src.name if src else source_id),
        base_url=(src.base_url if src else ""),
        novel_count=(src.novel_count if src else 0),
        last_sync=(src.last_sync_at.isoformat() if src and src.last_sync_at else None),
    )

    novels: list[NovelRecord] = []
    rows = (await session.scalars(select(Novel).where(Novel.source_id == source_id).order_by(Novel.id))).all()
    for n in rows:
        chs = (
            await session.scalars(
                select(Chapter).where(Chapter.novel_id == n.id).order_by(Chapter.number)
            )
        ).all()
        novels.append(
            NovelRecord(
                id=n.id, source_id=n.source_id, slug=n.slug, title=n.title, author=n.author,
                description=n.description, cover_path=n.cover_path, language=n.language,
                status=n.status, tags=list(n.tags or []),
                updated_at=(n.updated_at.isoformat() if n.updated_at else None),
                chapters=[
                    ChapterRecord(
                        id=c.id, number=float(c.number), title=c.title, published_at=c.published_at,
                        word_count=c.word_count, content_path=c.content_path, content_hash=c.content_hash,
                    )
                    for c in chs
                ],
            )
        )
    return source, novels
