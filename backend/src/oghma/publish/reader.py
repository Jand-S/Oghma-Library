"""Le novels/capitulos do Postgres e converte em records (async)."""
from __future__ import annotations

from .records import ChapterRecord, NovelRecord, SourceRecord
from ..taxonomy import canonical_tag_keys


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
                tag_keys=list(n.tag_keys or []) or canonical_tag_keys(n.tags or []),
                extra=dict(n.extra or {}),
                updated_at=(n.updated_at.isoformat() if n.updated_at else None),
                chapters=[
                    ChapterRecord(
                        id=c.id, number=float(c.number), title=c.title, published_at=c.published_at,
                        word_count=c.word_count, content_path=c.content_path, content_hash=c.content_hash,
                    )
                    for c in chs
                    if _publishable(c)
                ],
                missing=missing_chapters(chs),
            )
        )
    return source, novels


def _publishable(chapter) -> bool:
    """So capitulos com conteudo proprio entram no livro: invalidos e copias ficam de fora."""
    status = getattr(chapter, "status", None) or "ok"
    return status == "ok" and bool(chapter.content_path) and bool(chapter.downloaded)


MAX_GAP = 20
MAX_MISSING = 300


def missing_chapters(chapters) -> list[dict]:
    """Capitulos sem conteudo e numeros inteiros pulados entre capitulos existentes.

    Copias (`duplicate`) nao entram: o capitulo original esta no livro. Lacunas so sao
    procuradas entre numeros inteiros, porque algumas fontes usam posicoes decimais
    (0.1, 1.21) que nao sao numeros de capitulo.
    """
    out: list[dict] = []
    for c in chapters:
        status = getattr(c, "status", None) or "ok"
        if status == "invalid" or (status == "ok" and not (c.content_path and c.downloaded)):
            out.append({"number": float(c.number), "title": c.title,
                        "reason": getattr(c, "problem", None) or "empty"})
    present = sorted({float(c.number) for c in chapters})
    whole = [n for n in present if n == int(n)]
    for a, b in zip(whole, whole[1:]):
        if 1 < b - a <= MAX_GAP:
            for k in range(int(a) + 1, int(b)):
                out.append({"number": float(k), "title": f"Capítulo {k}", "reason": "gap"})
    out.sort(key=lambda m: m["number"])
    return out[:MAX_MISSING]
