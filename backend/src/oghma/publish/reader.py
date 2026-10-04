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
                first_seen_at=(n.first_seen_at.isoformat() if n.first_seen_at else None),
                last_new_chapter_at=(n.last_new_chapter_at.isoformat() if n.last_new_chapter_at else None),
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
    return source, merge_moved(novels)


def merge_moved(novels: list[NovelRecord]) -> list[NovelRecord]:
    """Tira as novels que mudaram de endereco (`extra.moved_to`) e passa a historia delas para a
    nova: o id antigo vira apelido e a chegada fica a mais antiga (senao Shadow Slave apareceria
    como recem-chegada no dia em que o site trocou o slug)."""
    by_id = {n.id: n for n in novels}
    kept = []
    for novel in novels:
        target = by_id.get((novel.extra or {}).get("moved_to") or "")
        if target is None or target is novel:
            kept.append(novel)
            continue
        target.aliases = sorted({*target.aliases, novel.id, *novel.aliases})
        if novel.first_seen_at and (not target.first_seen_at or novel.first_seen_at < target.first_seen_at):
            target.first_seen_at = novel.first_seen_at
    return kept


def _publishable(chapter) -> bool:
    """So capitulos com conteudo proprio entram no livro: invalidos e copias ficam de fora."""
    status = getattr(chapter, "status", None) or "ok"
    return status == "ok" and bool(chapter.content_path) and bool(chapter.downloaded)


MAX_GAP = 20
MAX_MISSING = 300


def missing_chapters(chapters) -> list[dict]:
    """Capitulos sem conteudo e numeros inteiros pulados entre capitulos existentes.

    Uma copia com o mesmo numero inteiro do original (4 e 4.01) nao falta nada. Ja uma
    copia em outro numero (o 47 com o texto do 46) significa que o 47 de verdade nao
    existe na fonte: entra como `repeated`. Lacunas so sao procuradas entre numeros
    inteiros, porque algumas fontes usam posicoes decimais (0.1, 1.21).
    """
    out: list[dict] = []
    for c in chapters:
        status = getattr(c, "status", None) or "ok"
        problem = getattr(c, "problem", None) or ""
        if status == "invalid" or (status == "ok" and not (c.content_path and c.downloaded)):
            out.append({"number": float(c.number), "title": c.title, "reason": problem or "empty"})
        elif status == "duplicate" and problem.startswith("same_as:"):
            try:
                original = float(problem.split(":", 1)[1])
            except ValueError:
                continue
            if int(original) != int(float(c.number)):
                out.append({"number": float(c.number), "title": c.title, "reason": "repeated"})
    present = sorted({float(c.number) for c in chapters})
    whole = [n for n in present if n == int(n)]
    for a, b in zip(whole, whole[1:]):
        if 1 < b - a <= MAX_GAP:
            for k in range(int(a) + 1, int(b)):
                out.append({"number": float(k), "title": f"Capítulo {k}", "reason": "gap"})
    out.sort(key=lambda m: m["number"])
    return out[:MAX_MISSING]
