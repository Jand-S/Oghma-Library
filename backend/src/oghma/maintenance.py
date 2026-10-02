"""Manutencao do acervo: auditoria, marcacao de capitulos ruins e limpeza de sinopses.

Tudo roda em modo de teste por padrao. Com `apply=True`, grava antes um backup JSON
em `<storage_root>/reports/` com os valores antigos de cada linha alterada.
"""
from __future__ import annotations

import json
import time
from collections import Counter, defaultdict
from pathlib import Path

from sqlalchemy import func, select

from .config import get_settings
from .db import SessionLocal
from .models import Chapter, Novel
from .scraper.normalize import _PLACEHOLDER_MAX_WORDS, chapter_problem, clean_description

DESCRIPTION_SAMPLES = 20


def _reports_dir() -> Path:
    path = Path(get_settings().storage_root) / "reports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _write_report(name: str, payload: dict) -> Path:
    path = _reports_dir() / f"{name}-{time.strftime('%Y%m%d-%H%M%S')}.json"
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return path


def _read_content(path: str | None) -> str | None:
    if not path:
        return None
    try:
        return Path(path).read_text(encoding="utf-8")
    except (FileNotFoundError, UnicodeDecodeError):
        return None


def description_issues(text: str | None) -> list[str]:
    """Problemas visiveis numa sinopse salva (usado pela auditoria e pelos testes)."""
    if not text or len(text.strip()) < 40:
        return ["empty"]
    issues = []
    if "<" in text and ">" in text:
        issues.append("html")
    if "&" in text and ";" in text and any(e in text for e in ("&nbsp;", "&amp;", "&#", "acute;", "tilde;", "cedil;")):
        issues.append("entities")
    cleaned = clean_description(text)
    if cleaned and len(cleaned) < len(text.strip()) * 0.85 and not issues:
        issues.append("junk")
    return issues


async def classify_chapters(source: str | None = None) -> list[dict]:
    """Capitulos ja salvos que devem mudar de status.

    - `invalid`: arquivo ausente ou vazio, sem imagem, ou placeholder curto.
    - `duplicate`: mesmo texto de um capitulo de numero menor da mesma novel.
    Le do disco so os capitulos curtos; os longos nao podem ser placeholder.
    """
    changes: list[dict] = []
    async with SessionLocal() as session:
        short_q = (
            select(Chapter.id, Chapter.novel_id, Chapter.number, Chapter.title, Chapter.content_path,
                   Chapter.word_count, Chapter.status, Novel.source_id)
            .join(Novel, Novel.id == Chapter.novel_id)
            .where(Chapter.status != "invalid", Chapter.word_count <= _PLACEHOLDER_MAX_WORDS)
        )
        if source:
            short_q = short_q.where(Novel.source_id == source)
        for row in (await session.execute(short_q)).all():
            html = _read_content(row.content_path)
            problem = "missing_file" if html is None else chapter_problem(html)
            if problem:
                changes.append({"id": row.id, "source": row.source_id, "novel_id": row.novel_id,
                                "number": float(row.number), "title": row.title,
                                "old_status": row.status, "new_status": "invalid", "problem": problem})

        invalid_ids = {c["id"] for c in changes}
        dup_q = (
            select(Chapter.id, Chapter.novel_id, Chapter.number, Chapter.title, Chapter.content_hash,
                   Chapter.status, Novel.source_id)
            .join(Novel, Novel.id == Chapter.novel_id)
            .where(Chapter.content_hash.is_not(None), Chapter.status != "invalid")
            .where(
                Chapter.content_hash.in_(
                    select(Chapter.content_hash)
                    .where(Chapter.content_hash.is_not(None))
                    .group_by(Chapter.novel_id, Chapter.content_hash)
                    .having(func.count() > 1)
                )
            )
            .order_by(Chapter.novel_id, Chapter.number)
        )
        if source:
            dup_q = dup_q.where(Novel.source_id == source)
        first_by_hash: dict[tuple[str, str], tuple[str, float]] = {}
        for row in (await session.execute(dup_q)).all():
            if row.id in invalid_ids:
                continue
            key = (row.novel_id, row.content_hash)
            if key not in first_by_hash:
                first_by_hash[key] = (row.id, float(row.number))
                continue
            original_number = first_by_hash[key][1]
            if row.status != "duplicate":
                changes.append({"id": row.id, "source": row.source_id, "novel_id": row.novel_id,
                                "number": float(row.number), "title": row.title,
                                "old_status": row.status, "new_status": "duplicate",
                                "problem": f"same_as:{original_number:g}"})
    return changes


async def mark_chapters(source: str | None = None, apply: bool = False) -> dict:
    changes = await classify_chapters(source)
    summary: dict = defaultdict(Counter)
    for c in changes:
        summary[c["source"]][f"{c['new_status']}:{c['problem'].split(':')[0]}"] += 1
    result = {"apply": apply, "source": source, "changes": len(changes),
              "summary": {k: dict(v) for k, v in sorted(summary.items())}}
    if not apply or not changes:
        return result
    backup = _write_report("mark-chapters-backup", {"source": source, "changes": changes})
    result["backup"] = str(backup)
    async with SessionLocal() as session:
        for i, c in enumerate(changes, start=1):
            ch = await session.get(Chapter, c["id"])
            if ch is None:
                continue
            ch.status = c["new_status"]
            ch.problem = c["problem"]
            if c["new_status"] == "invalid":
                ch.downloaded = False
                ch.word_count = 0
                ch.content_hash = None
            if i % 500 == 0:
                await session.commit()
        await session.commit()
    return result


async def clean_descriptions(source: str | None = None, apply: bool = False) -> dict:
    """Aplica clean_description nas sinopses salvas. Nao busca nada na internet."""
    changes = []
    async with SessionLocal() as session:
        q = select(Novel.id, Novel.source_id, Novel.title, Novel.description).where(Novel.description.is_not(None))
        if source:
            q = q.where(Novel.source_id == source)
        for row in (await session.execute(q)).all():
            new = clean_description(row.description)
            if new and new != row.description:
                changes.append({"id": row.id, "source": row.source_id, "title": row.title,
                                "old": row.description, "new": new})
    per_source = Counter(c["source"] for c in changes)
    result = {"apply": apply, "source": source, "changes": len(changes), "per_source": dict(per_source),
              "samples": [{"title": c["title"], "old": c["old"][:400], "new": c["new"][:400]}
                          for c in changes[:DESCRIPTION_SAMPLES]]}
    if not apply or not changes:
        return result
    backup = _write_report("clean-descriptions-backup", {"source": source, "changes": changes})
    result["backup"] = str(backup)
    async with SessionLocal() as session:
        for c in changes:
            nv = await session.get(Novel, c["id"])
            if nv is not None:
                nv.description = c["new"]
        await session.commit()
    return result


async def refresh_descriptions(
    source: str, *, only_missing: bool = False, apply: bool = False, limit: int | None = None
) -> dict:
    """Le de novo a pagina de cada novel no site e troca so a sinopse (ja limpa).

    Para fontes cujo texto salvo perdeu a estrutura (paragrafos colados) ou veio vazio.
    """
    import oghma.scraper.connectors  # noqa: F401  (registra conectores)
    from .scraper import registry
    from .scraper.base import NovelRef
    from .scraper.fetcher import HttpFetcher

    connector = registry.get(source)
    headers_provider = getattr(connector, "request_headers", None)
    headers = headers_provider() if callable(headers_provider) else getattr(connector, "headers", None)
    fetcher = HttpFetcher(
        connector.rate_limit_seconds, headers=headers, http2=getattr(connector, "http2", True),
        use_curl=getattr(connector, "use_curl", False), curl_bin=getattr(connector, "curl_bin", "curl"),
    )
    changes, errors, unchanged = [], [], 0
    try:
        async with SessionLocal() as session:
            q = select(Novel.id, Novel.slug, Novel.title, Novel.source_url, Novel.description).where(
                Novel.source_id == source
            )
            if only_missing:
                q = q.where((Novel.description.is_(None)) | (func.length(func.trim(Novel.description)) < 40))
            rows = (await session.execute(q.order_by(Novel.id))).all()
        if limit:
            rows = rows[:limit]
        for row in rows:
            try:
                meta = await connector.fetch_novel(fetcher, NovelRef(source, row.slug, row.source_url))
            except Exception as exc:  # uma novel com erro nao para as outras
                errors.append({"id": row.id, "error": str(exc)[:200]})
                continue
            new = clean_description(meta.description)
            if new and new != row.description:
                changes.append({"id": row.id, "source": source, "title": row.title, "old": row.description, "new": new})
            else:
                unchanged += 1
    finally:
        await fetcher.aclose()
    result = {"apply": apply, "source": source, "checked": len(changes) + unchanged + len(errors),
              "changes": len(changes), "unchanged": unchanged, "errors": errors[:20],
              "samples": [{"title": c["title"], "old": (c["old"] or "")[:300], "new": c["new"][:400]}
                          for c in changes[:DESCRIPTION_SAMPLES]]}
    if not apply or not changes:
        return result
    backup = _write_report("refresh-descriptions-backup", {"source": source, "changes": changes})
    result["backup"] = str(backup)
    async with SessionLocal() as session:
        for c in changes:
            nv = await session.get(Novel, c["id"])
            if nv is not None:
                nv.description = c["new"]
        await session.commit()
    return result


async def audit_content(source: str | None = None) -> dict:
    """Relatorio somente leitura do estado do acervo, por fonte."""
    report: dict = {}
    async with SessionLocal() as session:
        q = (
            select(Novel.source_id, Chapter.status, func.count())
            .join(Novel, Novel.id == Chapter.novel_id)
            .group_by(Novel.source_id, Chapter.status)
        )
        if source:
            q = q.where(Novel.source_id == source)
        for src, status, n in (await session.execute(q)).all():
            report.setdefault(src, {}).setdefault("chapters_by_status", {})[status or "ok"] = int(n)
        dq = select(Novel.source_id, Novel.description)
        if source:
            dq = dq.where(Novel.source_id == source)
        for src, desc in (await session.execute(dq)).all():
            entry = report.setdefault(src, {}).setdefault("descriptions", Counter())
            entry["total"] += 1
            for issue in description_issues(desc):
                entry[issue] += 1
    pending = await classify_chapters(source)
    for c in pending:
        entry = report.setdefault(c["source"], {}).setdefault("pending_marks", Counter())
        entry[f"{c['new_status']}:{c['problem'].split(':')[0]}"] += 1
    for src in report.values():
        for key in ("descriptions", "pending_marks"):
            if key in src:
                src[key] = dict(src[key])
    path = _write_report("content-audit", {"source": source, "report": report, "pending": pending[:2000]})
    return {"report": report, "path": str(path)}
